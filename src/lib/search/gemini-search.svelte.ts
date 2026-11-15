// Descriptive photo search via Google's Gemini API (free tier). The user pastes
// their own API key in Settings; it's kept on this device only. Given a query
// like "moreno", Gemini looks at profile photos and says which ones match, so
// the search finds people by what's in their pictures, not just their text.

import { invoke, isTauri } from "@tauri-apps/api/core";

const KEY_STORAGE = "gemini-api-key-v1";
// "latest" alias so the app keeps working when Google rotates models (the
// pinned 2.x names already got deprecated). Lite is fast and cheap, which suits
// classifying many photos within the free tier.
const MODEL = "gemini-flash-lite-latest";
// How many photos go in one Gemini request. Small batches stay within the free
// tier's payload limits and let partial results come back sooner.
export const GEMINI_BATCH = 6;
// Thumbnails are small, so more of them fit in one request.
export const GEMINI_THUMB_BATCH = 12;

export function geminiEndpoint(key: string): string {
	return `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`;
}

class GeminiSettings {
	apiKey = $state(load());

	get configured(): boolean {
		return this.apiKey.trim() !== "";
	}

	save(key: string): void {
		this.apiKey = key.trim();
		try {
			if (this.apiKey) localStorage.setItem(KEY_STORAGE, this.apiKey);
			else localStorage.removeItem(KEY_STORAGE);
		} catch {
			/* storage unavailable */
		}
	}
}

function load(): string {
	try {
		return localStorage.getItem(KEY_STORAGE) ?? "";
	} catch {
		return "";
	}
}

export const gemini = new GeminiSettings();

// Fetch a profile photo and return it base64-encoded. On Tauri the webview can't
// fetch Grindr media directly (mixed content), so the native command does it.
async function photoBase64(
	mediaHash: string,
	thumb = false,
): Promise<string | null> {
	// The thumbnail is what the grid shows: much lighter, enough for an overview.
	const url = thumb
		? `https://cdns.grindr.com/images/thumb/320x320/${mediaHash}`
		: `https://cdns.grindr.com/images/profile/1024x1024/${mediaHash}`;
	try {
		if (isTauri()) {
			return await invoke<string>("fetch_media_b64", {
				url,
				isVideo: false,
			});
		}
		const response = await fetch(url);
		if (!response.ok) return null;
		const buffer = await response.arrayBuffer();
		const bytes = new Uint8Array(buffer);
		let binary = "";
		for (let i = 0; i < bytes.length; i += 1)
			binary += String.fromCharCode(bytes[i] ?? 0);
		return btoa(binary);
	} catch {
		return null;
	}
}

function parseMatchNumbers(text: string): number[] {
	const bracket = text.match(/\[[\s\S]*?\]/);
	const body = bracket ? bracket[0] : text;
	return [...body.matchAll(/\d+/g)]
		.map((match) => Number(match[0]))
		.filter((value) => Number.isFinite(value));
}

export type VisionCandidate = { id: number; mediaHash: string };

export type BatchResult = {
	/** Ids from the batch whose photo matches the query. */
	matches: number[];
	/** Some photo couldn't be fetched or the request failed. */
	failed: boolean;
	/** The key was rejected: no point in sending more batches. */
	fatal: boolean;
};

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ask Gemini which photos of one batch (up to GEMINI_BATCH) match `query`.
 * Waits and retries when the free tier's rate limit is hit; `shouldStop` lets
 * the caller abandon that wait.
 */
export async function geminiMatchBatch({
	query,
	batch,
	thumbs = false,
	shouldStop,
}: {
	query: string;
	batch: VisionCandidate[];
	/** Look at the grid thumbnails instead of the full-size photo. */
	thumbs?: boolean;
	shouldStop?: () => boolean;
}): Promise<BatchResult> {
	const result: BatchResult = { matches: [], failed: false, fatal: false };
	if (!gemini.configured) return { ...result, failed: true, fatal: true };
	const order: number[] = [];
	const images: unknown[] = [];
	for (const candidate of batch) {
		if (shouldStop?.()) return result;
		const data = await photoBase64(candidate.mediaHash, thumbs);
		if (!data) {
			result.failed = true;
			continue;
		}
		images.push({ inlineData: { mimeType: "image/jpeg", data } });
		order.push(candidate.id);
	}
	if (order.length === 0) return result;
	const parts: unknown[] = [
		{
			text:
				`Te muestro ${order.length} fotos de perfil, numeradas del 1 al ${order.length} en el orden en que aparecen. ` +
				`Devolvé SOLO un array JSON con los números de las fotos que coincidan con esta descripción: "${query}". ` +
				`Considerá lo que se ve en la imagen (personas, apariencia, rasgos, lugar, objetos). Si ninguna coincide, devolvé []. No expliques nada.`,
		},
		...images,
	];
	const body = JSON.stringify({ contents: [{ parts }] });
	for (let attempt = 0; attempt < 4; attempt += 1) {
		if (shouldStop?.()) return result;
		try {
			const response = await fetch(geminiEndpoint(gemini.apiKey), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body,
			});
			if (response.status === 429 || response.status === 503) {
				// Rate limited / overloaded: the free tier recovers within a
				// minute, so wait instead of losing the batch.
				await sleep(20000);
				continue;
			}
			if (!response.ok) {
				console.error("[gemini] HTTP", response.status);
				result.failed = true;
				result.fatal = [400, 401, 403].includes(response.status);
				return result;
			}
			const json: unknown = await response.json();
			const text =
				(
					json as {
						candidates?: {
							content?: { parts?: { text?: string }[] };
						}[];
					}
				)?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
			for (const number of parseMatchNumbers(text)) {
				const id = order[number - 1];
				if (id !== undefined) result.matches.push(id);
			}
			return result;
		} catch (error) {
			console.error("[gemini] request failed", error);
			// Likely offline for a moment (e.g. the phone switching networks).
			await sleep(5000);
		}
	}
	result.failed = true;
	return result;
}
