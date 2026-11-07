// Saves a received item to the phone's gallery (native, into a visible folder).
// On Android the native command fetches the bytes itself (the webview can't
// fetch the proxied media: http scheme vs the https app). On the web it falls
// back to a normal browser download through the proxy.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { receivedArchive } from "$lib/received/archive.svelte";
import {
	archivableFromItem,
	type ReceivedItem,
} from "$lib/received/received-media";
import { proxyMediaUrl } from "$lib/util/media";

/** The album folder the native command writes into (Pictures/ and Movies/). */
export const GALLERY_FOLDER = "Martins Grindr";

/** Saves a raw media URL to the gallery under `baseName` (extension chosen by
 *  the real content type on the native side). */
export async function saveUrlToDevice({
	rawUrl,
	baseName,
	isVideo,
}: {
	rawUrl: string;
	baseName: string;
	isVideo: boolean;
}): Promise<void> {
	if (isTauri()) {
		await invoke("save_media_to_gallery", {
			url: rawUrl,
			baseName,
			isVideo,
		});
		return;
	}

	const proxied =
		proxyMediaUrl(rawUrl, { as: isVideo ? "video" : "image" }) ?? rawUrl;
	const res = await fetch(proxied);
	if (!res.ok) throw new Error(`descarga ${res.status}`);
	const blob = await res.blob();
	const ext = isVideo ? "mp4" : "jpg";
	const blobUrl = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = blobUrl;
	a.download = `${baseName}.${ext}`;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
}

export async function saveItemToDevice(item: ReceivedItem): Promise<void> {
	// Best-effort in-app copy (may be unavailable on device); the gallery save
	// below is the reliable one.
	void receivedArchive.save(archivableFromItem(item));
	await saveUrlToDevice({
		rawUrl: item.rawUrl,
		baseName: item.id.replace(/[^a-z0-9]/gi, "_"),
		isVideo: item.kind === "video",
	});
}
