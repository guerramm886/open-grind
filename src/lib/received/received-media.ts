// Collects the photos, videos and shared-album contents that the OTHER person
// sent you in a conversation, so they can be shown in one gallery and archived.
// Album messages are expanded into their individual items.

import { getAlbumContent } from "$lib/api/messaging/albums";
import { getConversationMessages } from "$lib/api/messaging/messages";
import { isVideoContent } from "$lib/components/album/album";
import { proxyMediaUrl } from "$lib/util/media";
import type { ArchivableItem } from "$lib/received/archive.svelte";

export type ReceivedItem = {
	id: string;
	conversationId: string;
	profileId: number | null;
	kind: "image" | "video";
	/** Proxied URL for display/playback (and for archiving). */
	url: string;
	/** Proxied still image for the grid thumbnail. */
	thumbUrl: string;
	contentType: string;
	albumId: number | null;
	name: string | null;
	timestamp: number;
	/** False when the source is no longer fetchable (e.g. already viewed). */
	available: boolean;
};

export type ReceivedProfile = {
	profileId: number;
	name: string | null;
	distance: number | null;
	mediaHash: string | null;
};

export type ReceivedMediaResult = {
	profile: ReceivedProfile | null;
	items: ReceivedItem[];
};

export function archivableFromItem(item: ReceivedItem): ArchivableItem {
	return {
		id: item.id,
		conversationId: item.conversationId,
		profileId: item.profileId,
		kind: item.kind,
		contentType: item.contentType,
		name: item.name,
		albumId: item.albumId,
		url: item.url,
	};
}

async function expandAlbum({
	conversationId,
	albumId,
	profileId,
	timestamp,
}: {
	conversationId: string;
	albumId: number;
	profileId: number | null;
	timestamp: number;
}): Promise<ReceivedItem[]> {
	try {
		const album = await getAlbumContent(albumId);
		return album.content
			.filter((content) => !content.processing)
			.map((content): ReceivedItem => {
				const kind = isVideoContent(content.contentType)
					? "video"
					: "image";
				const still = content.coverUrl ?? content.thumbUrl;
				return {
					id: `album:${albumId}:${content.contentId}`,
					conversationId,
					profileId,
					kind,
					url: proxyMediaUrl(content.url || still, { as: kind }) ?? "",
					thumbUrl: proxyMediaUrl(still) ?? "",
					contentType: content.contentType,
					albumId,
					name: album.albumName,
					timestamp,
					available: content.url !== "" || kind === "image",
				};
			});
	} catch (error) {
		console.error("[received-media] album expand failed", albumId, error);
		return [];
	}
}

export async function loadReceivedMedia({
	conversationId,
	ourProfileId,
}: {
	conversationId: string;
	ourProfileId: number;
}): Promise<ReceivedMediaResult> {
	const page = await getConversationMessages({ conversationId });
	const profile: ReceivedProfile = {
		profileId: page.profile.profileId,
		name: page.profile.name,
		distance: page.profile.showDistance ? page.profile.distance : null,
		mediaHash: page.profile.mediaHash,
	};

	const direct: ReceivedItem[] = [];
	const albumJobs: Promise<ReceivedItem[]>[] = [];
	const seenAlbums = new Set<number>();

	for (const message of page.messages) {
		if (message.senderId === ourProfileId || message.unsent) continue;
		const ts = message.timestamp;
		switch (message.type) {
			case "Image":
			case "ExpiringImage": {
				const url = message.body.url;
				const mediaId = message.body.mediaId;
				if (!url) break;
				direct.push({
					id: `img:${mediaId}`,
					conversationId,
					profileId: profile.profileId,
					kind: "image",
					url: proxyMediaUrl(url, { as: "image" }) ?? url,
					thumbUrl: proxyMediaUrl(url, { as: "image" }) ?? url,
					contentType: "image/jpeg",
					albumId: null,
					name: null,
					timestamp: ts,
					available: true,
				});
				break;
			}
			case "Video":
			case "PrivateVideo": {
				const url = message.body.url;
				if (!url) break;
				const mediaId = message.body.mediaId ?? message.messageId;
				direct.push({
					id: `vid:${mediaId}`,
					conversationId,
					profileId: profile.profileId,
					kind: "video",
					url: proxyMediaUrl(url, { as: "video" }) ?? url,
					thumbUrl: proxyMediaUrl(url, { as: "video" }) ?? url,
					contentType: message.body.contentType ?? "video/mp4",
					albumId: null,
					name: null,
					timestamp: ts,
					available: true,
				});
				break;
			}
			case "Album":
			case "ExpiringAlbum":
			case "ExpiringAlbumV2": {
				const albumId = message.body.albumId;
				if (!message.body.isViewable || seenAlbums.has(albumId)) break;
				seenAlbums.add(albumId);
				albumJobs.push(
					expandAlbum({
						conversationId,
						albumId,
						profileId: message.body.ownerProfileId ?? profile.profileId,
						timestamp: ts,
					}),
				);
				break;
			}
			default:
				break;
		}
	}

	const fromAlbums = (await Promise.all(albumJobs)).flat();
	const items = [...direct, ...fromAlbums]
		.filter((item) => item.url !== "")
		.sort((a, b) => b.timestamp - a.timestamp);

	// De-duplicate in case the same media appears twice in the window.
	const byId = new Map<string, ReceivedItem>();
	for (const item of items) if (!byId.has(item.id)) byId.set(item.id, item);

	return { profile, items: [...byId.values()] };
}
