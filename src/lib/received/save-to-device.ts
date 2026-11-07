// Saves a received item to the phone's gallery (native, into a visible folder)
// and keeps an in-app copy. On non-Android it falls back to a browser download.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { receivedArchive } from "$lib/received/archive.svelte";
import {
	archivableFromItem,
	type ReceivedItem,
} from "$lib/received/received-media";

/** The album folder the native command writes into (Pictures/ and Movies/). */
export const GALLERY_FOLDER = "Martins Grindr";

/** Fetches a media URL and writes it to the phone gallery under `filename`. */
export async function saveUrlToDevice({
	url,
	filename,
	isVideo,
}: {
	url: string;
	filename: string;
	isVideo: boolean;
}): Promise<void> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`descarga ${res.status}`);
	const bytes = new Uint8Array(await res.arrayBuffer());
	const mime = isVideo ? "video/mp4" : "image/jpeg";

	if (isTauri()) {
		await invoke("save_media_to_gallery", {
			data: Array.from(bytes),
			filename,
			mime,
			isVideo,
		});
		return;
	}

	const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
	const a = document.createElement("a");
	a.href = blobUrl;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
}

export async function saveItemToDevice(item: ReceivedItem): Promise<void> {
	const ext = item.kind === "video" ? "mp4" : "jpg";
	const filename = `${item.id.replace(/[^a-z0-9]/gi, "_")}.${ext}`;
	// Always keep a persistent in-app copy too (survives the sender deleting it).
	void receivedArchive.save(archivableFromItem(item));
	await saveUrlToDevice({
		url: item.url,
		filename,
		isVideo: item.kind === "video",
	});
}
