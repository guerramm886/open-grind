import { proxyMediaUrl } from "$lib/util/media";
import { receivedArchive } from "./archive.svelte";

/**
 * Keep a local copy of a view-once photo or video someone sent, at the moment
 * it is opened: that is the only time the server hands out its URL, and
 * asking for it earlier would spend the view. Uses the same ids as the
 * Recibidos scan (`img:`/`vid:`), so it is never stored twice. Best effort.
 */
export function keepExpiringMedia({
	conversationId,
	senderId,
	sentAt,
	kind,
	mediaKey,
	rawUrl,
	contentType,
}: {
	conversationId: string;
	senderId: number | null;
	sentAt: number | null;
	kind: "image" | "video";
	mediaKey: string | number;
	rawUrl: string;
	contentType?: string | null;
}): void {
	void receivedArchive
		.save({
			id: `${kind === "video" ? "vid" : "img"}:${mediaKey}`,
			conversationId,
			profileId: senderId,
			kind,
			contentType:
				contentType ?? (kind === "video" ? "video/mp4" : "image/jpeg"),
			name: null,
			albumId: null,
			sentAt: sentAt ?? undefined,
			url: proxyMediaUrl(rawUrl, { as: kind }) ?? rawUrl,
			rawUrl,
		})
		.catch((error: unknown) => {
			console.error("[keep-expiring] save failed", error);
		});
}
