import { convertFileSrc, isTauri } from "@tauri-apps/api/core";

import { demoEnabled, demoMediaUrl } from "$lib/demo";
import { toBase64Url } from "$lib/util/base64";

const MEDIA_SCHEME = "ogmedia";

const CDN_VARIANTS = {
	thumb: "thumb/320x320",
	full: "profile/1024x1024",
} as const;

const FETCHER_TAG = { image: "i", video: "v" } as const;

type ProxyOptions = { as?: keyof typeof FETCHER_TAG };

export function proxyMediaUrl(url: string, options?: ProxyOptions): string;
export function proxyMediaUrl(
	url: string | null | undefined,
	options?: ProxyOptions,
): string | null;
export function proxyMediaUrl(
	url: string | null | undefined,
	{ as = "image" }: ProxyOptions = {},
): string | null {
	if (typeof url !== "string") return null;
	if (demoEnabled || !isTauri()) return url;
	if (!url.startsWith("https://")) return url;
	const payload = toBase64Url(new TextEncoder().encode(url));
	return convertFileSrc(`${FETCHER_TAG[as]}${payload}`, MEDIA_SCHEME);
}

/**
 * The original https URL behind a proxied one (what `proxyMediaUrl` wrapped),
 * for the native commands that fetch the bytes themselves. Null when `src` is
 * neither proxied nor a plain https URL.
 */
export function unproxyMediaUrl(
	src: string,
): { url: string; isVideo: boolean } | null {
	let parsed: URL;
	try {
		parsed = new URL(src, location.href);
	} catch {
		return null;
	}
	if (!isProxiedMediaUrl(parsed))
		return parsed.protocol === "https:"
			? { url: parsed.href, isVideo: false }
			: null;
	try {
		const token = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
		const b64 = token.slice(1).replace(/-/g, "+").replace(/_/g, "/");
		const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
		const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
		const url = new TextDecoder().decode(bytes);
		if (!url.startsWith("https://")) return null;
		return { url, isVideo: token.startsWith(FETCHER_TAG.video) };
	} catch {
		return null;
	}
}

export function isProxiedMediaUrl(url: URL): boolean {
	return (
		url.protocol === `${MEDIA_SCHEME}:` ||
		url.hostname === `${MEDIA_SCHEME}.localhost`
	);
}

export function profileMediaUrl({
	mediaHash,
	size,
}: {
	mediaHash: string;
	size: keyof typeof CDN_VARIANTS;
}): string {
	if (demoEnabled) return demoMediaUrl(mediaHash);
	return proxyMediaUrl(
		`https://cdns.grindr.com/images/${CDN_VARIANTS[size]}/${mediaHash}`,
	);
}

export function retryMediaSrc({
	src,
	attempt,
}: {
	src: string;
	attempt: number;
}): string {
	return `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}`;
}

export function firstFrameSrc(src: string): string {
	return `${src}#t=0.001`;
}

export function releaseVideoOnDestroy(video: HTMLVideoElement): () => void {
	return () => {
		video.removeAttribute("src");
		video.load();
	};
}
