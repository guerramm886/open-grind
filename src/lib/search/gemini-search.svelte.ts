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
const BATCH = 6;

function endpoint(key: string): string {
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
async function photoBase64(mediaHash: string): Promise<string | null> {
	const url = `https://cdns.grindr.com/images/profile/1024x1024/${mediaHash}`;
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

/**
 * Ask Gemini which candidates' photos match `query`. Returns the matching ids.
 * `shouldStop` lets a newer search cancel this one between batches.
 */
export async function geminiMatchPhotos({
	query,
	candidates,
	onProgress,
	shouldStop,
}: {
	query: string;
	candidates: VisionCandidate[];
	onProgress?: (done: number, total: number) => void;
	shouldStop?: () => boolean;
}): Promise<{ matches: Set<number>; failed: boolean }> {
	const matches = new Set<number>();
	let failed = false;
	if (!gemini.configured || query.trim() === "")
		return { matches, failed };

	let done = 0;
	for (let start = 0; start < candidates.length; start += BATCH) {
		if (shouldStop?.()) break;
		const batch = candidates.slice(start, start + BATCH);
		const order: number[] = [];
		const parts: unknown[] = [
			{
				text:
					`Te muestro ${batch.length} fotos de perfil, numeradas del 1 al ${batch.length} en el orden en que aparecen. ` +
					`Devolvé SOLO un array JSON con los números de las fotos que coincidan con esta descripción: "${query}". ` +
					`Considerá lo que se ve en la imagen (personas, apariencia, rasgos, lugar, objetos). Si ninguna coincide, devolvé []. No expliques nada.`,
			},
		];
		for (const candidate of batch) {
			const data = await photoBase64(candidate.mediaHash);
			if (!data) continue;
			parts.push({ inlineData: { mimeType: "image/jpeg", data } });
			order.push(candidate.id);
		}
		done += batch.length;
		onProgress?.(Math.min(done, candidates.length), candidates.length);
		if (order.length === 0) continue;
		try {
			const response = await fetch(endpoint(gemini.apiKey), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ contents: [{ parts }] }),
			});
			if (!response.ok) {
				console.error("[gemini] HTTP", response.status);
				failed = true;
				continue;
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
				if (id !== undefined) matches.add(id);
			}
		} catch (error) {
			console.error("[gemini] request failed", error);
			failed = true;
		}
	}
	return { matches, failed };
}
