// What's on screen right now, for the Gemini bubble: the visible text plus the
// largest visible images. (A webview can't take a real screenshot of itself, so
// this is the closest equivalent.)

import { invoke, isTauri } from "@tauri-apps/api/core";

import { unproxyMediaUrl } from "$lib/util/media";

/** Elements carrying this attribute (the bubble itself) are left out. */
export const SCREEN_CAPTURE_IGNORE = "data-screen-capture-ignore";

const MAX_TEXT = 4000;
const MIN_IMAGE_SIDE = 90;

export type ScreenImage = { mimeType: string; data: string };
export type ScreenCapture = { text: string; images: ScreenImage[] };

function onScreen(rect: DOMRect): boolean {
	return (
		rect.width > 0 &&
		rect.height > 0 &&
		rect.bottom > 0 &&
		rect.right > 0 &&
		rect.top < window.innerHeight &&
		rect.left < window.innerWidth
	);
}

function ignored(element: Element | null): boolean {
	return element?.closest(`[${SCREEN_CAPTURE_IGNORE}]`) != null;
}

function visibleText(): string {
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
	const seen: string[] = [];
	let length = 0;
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const text = node.textContent?.replace(/\s+/g, " ").trim() ?? "";
		const parent = node.parentElement;
		if (text === "" || !parent || ignored(parent)) continue;
		if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) continue;
		if (!onScreen(parent.getBoundingClientRect())) continue;
		const style = getComputedStyle(parent);
		if (style.visibility === "hidden" || style.display === "none") continue;
		seen.push(text);
		length += text.length + 1;
		if (length >= MAX_TEXT) break;
	}
	return seen.join("\n").slice(0, MAX_TEXT);
}

// The native fetch returns bare base64, so read the format off its first bytes.
function mimeOf(base64: string): string {
	if (base64.startsWith("iVBOR")) return "image/png";
	if (base64.startsWith("UklGR")) return "image/webp";
	if (base64.startsWith("R0lGOD")) return "image/gif";
	return "image/jpeg";
}

async function blobBase64(src: string): Promise<string | null> {
	try {
		const blob = await fetch(src).then((response) => response.blob());
		const dataUrl = await new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () => reject(new Error("read failed"));
			reader.readAsDataURL(blob);
		});
		return dataUrl.split(",")[1] ?? null;
	} catch {
		return null;
	}
}

async function imageBase64(src: string): Promise<string | null> {
	if (src.startsWith("blob:") || src.startsWith("data:"))
		return blobBase64(src);
	const original = unproxyMediaUrl(src);
	if (!original || original.isVideo) return null;
	try {
		if (isTauri())
			return await invoke<string>("fetch_media_b64", {
				url: original.url,
				isVideo: false,
			});
		return await blobBase64(original.url);
	} catch {
		return null;
	}
}

export async function captureScreen(maxImages = 4): Promise<ScreenCapture> {
	const candidates = [...document.querySelectorAll("img")]
		.filter((image) => !ignored(image) && image.currentSrc !== "")
		.map((image) => ({ image, rect: image.getBoundingClientRect() }))
		.filter(
			({ rect }) =>
				onScreen(rect) &&
				rect.width >= MIN_IMAGE_SIDE &&
				rect.height >= MIN_IMAGE_SIDE,
		)
		// Biggest first: the photo being looked at beats avatars and thumbnails.
		.sort(
			(a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height,
		);
	const images: ScreenImage[] = [];
	const used = new Set<string>();
	for (const { image } of candidates) {
		if (images.length >= maxImages) break;
		const src = image.currentSrc;
		if (used.has(src)) continue;
		used.add(src);
		const data = await imageBase64(src);
		if (data) images.push({ mimeType: mimeOf(data), data });
	}
	return { text: visibleText(), images };
}
