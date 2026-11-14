// Collects the photos, videos and shared-album contents that the OTHER person
// sent you in a conversation, so they can be shown in one gallery and archived.
// Album messages are expanded into their individual items.

import { getAlbumContent, unshareAlbum } from "$lib/api/messaging/albums";
import { getConversationMessages } from "$lib/api/messaging/messages";
import { getProfile } from "$lib/api/users/profiles";
import { isVideoContent } from "$lib/components/album/album";
import {
	type ArchivableItem,
	receivedArchive,
} from "$lib/received/archive.svelte";
import { proxyMediaUrl } from "$lib/util/media";

export type ReceivedItem = {
	id: string;
	conversationId: string;
	profileId: number | null;
	kind: "image" | "video";
	/** Proxied URL for display/playback (and for archiving). */
	url: string;
	/** Raw (un-proxied) https URL, for the native gallery-save command. */
	rawUrl: string;
	/** Proxied still image for the grid thumbnail. */
	thumbUrl: string;
	contentType: string;
	albumId: number | null;
	name: string | null;
	timestamp: number;
	/** False when the source is no longer fetchable (e.g. already viewed). */
	available: boolean;
	/** Where it came from: a shared album, direct chat media, or a profile photo. */
	source: "album" | "direct" | "profile";
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
		sentAt: item.timestamp > 0 ? item.timestamp : undefined,
		url: item.url,
		rawUrl: item.rawUrl,
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
				const src = content.url || still;
				return {
					id: `album:${albumId}:${content.contentId}`,
					conversationId,
					profileId,
					kind,
					url: proxyMediaUrl(src, { as: kind }) ?? "",
					rawUrl: src,
					thumbUrl: proxyMediaUrl(still) ?? "",
					contentType: content.contentType,
					albumId,
					name: album.albumName,
					timestamp,
					available: content.url !== "" || kind === "image",
					source: "album",
				};
			});
	} catch (error) {
		console.error("[received-media] album expand failed", albumId, error);
		return [];
	}
}

export type ReceivedKinds = {
	hasAlbum: boolean;
	hasDirect: boolean;
	/** When the newest photo/video/album was sent in the chat (0 = none). */
	mediaAt: number;
};

const ALBUM_TYPES = new Set(["Album", "ExpiringAlbum", "ExpiringAlbumV2"]);
const DIRECT_TYPES = new Set([
	"Image",
	"ExpiringImage",
	"Video",
	"PrivateVideo",
]);

/**
 * Cheap check (one messages fetch, no album expansion) of what the OTHER person
 * sent in the recent window — only counting content that still looks available
 * (direct media with a URL, albums still marked viewable). Used to keep the grid
 * to people who actually sent you something, and to badge each card.
 */
export async function detectReceivedMedia({
	conversationId,
	ourProfileId,
}: {
	conversationId: string;
	ourProfileId: number;
}): Promise<ReceivedKinds> {
	const page = await getConversationMessages({ conversationId });
	let hasAlbum = false;
	let hasDirect = false;
	let mediaAt = 0;
	for (const message of page.messages) {
		if (message.senderId === ourProfileId || message.unsent) continue;
		const body = message.body as {
			url?: unknown;
			isViewable?: unknown;
		} | null;
		if (!body) continue;
		if (DIRECT_TYPES.has(message.type) && Boolean(body.url)) {
			hasDirect = true;
		} else if (ALBUM_TYPES.has(message.type) && body.isViewable === true) {
			hasAlbum = true;
		} else continue;
		mediaAt = Math.max(mediaAt, message.timestamp);
	}
	return { hasAlbum, hasDirect, mediaAt };
}

async function profilePhotoItems(
	conversationId: string,
	profileId: number,
): Promise<ReceivedItem[]> {
	try {
		const profile = await getProfile(profileId);
		return profile.medias.map((media): ReceivedItem => {
			const raw = `https://cdns.grindr.com/images/profile/1024x1024/${media.mediaHash}`;
			const proxied = proxyMediaUrl(raw, { as: "image" }) ?? raw;
			return {
				id: `profile:${profileId}:${media.mediaHash}`,
				conversationId,
				profileId,
				kind: "image",
				url: proxied,
				rawUrl: raw,
				thumbUrl: proxied,
				contentType: "image/jpeg",
				albumId: null,
				name: null,
				timestamp: 0,
				available: true,
				source: "profile",
			};
		});
	} catch (error) {
		console.error("[received-media] profile photos failed", error);
		return [];
	}
}

// Locally saved copies that the live API no longer returns (album removed or
// locked, message gone, person vanished). They have no URL: tiles and the
// viewer show them from the archive.
function archivedOnlyItems(
	conversationId: string,
	liveIds: ReadonlySet<string>,
): ReceivedItem[] {
	return receivedArchive
		.entriesFor(conversationId)
		.filter((entry) => !liveIds.has(entry.id))
		.map((entry): ReceivedItem => {
			let source: ReceivedItem["source"] = "direct";
			if (entry.albumId !== null) source = "album";
			else if (entry.id.startsWith("profile:")) source = "profile";
			return {
				id: entry.id,
				conversationId,
				profileId: entry.profileId,
				kind: entry.kind,
				url: "",
				rawUrl: "",
				thumbUrl: "",
				contentType: entry.contentType,
				albumId: entry.albumId,
				name: entry.name,
				// Sort by when it was sent, not by when we saved it.
				timestamp: entry.sentAt ?? 0,
				available: false,
				source,
			};
		});
}

/**
 * Save every photo and video of a received album into the app, and only once
 * ALL of them are safely stored, drop our access to it on Grindr's side. The
 * local copies keep showing in Recibidos.
 *
 * Grindr refuses DELETE on someone else's album (403), so this asks to be
 * removed from the album's shares instead.
 */
export async function keepAlbumOnlyLocally({
	conversationId,
	albumId,
	profileId,
	ourProfileId,
	sentAt,
}: {
	conversationId: string;
	albumId: number;
	profileId: number | null;
	ourProfileId: number;
	sentAt: number;
}): Promise<void> {
	const items = await expandAlbum({
		conversationId,
		albumId,
		profileId,
		timestamp: sentAt,
	});
	const savable = items.filter((item) => item.rawUrl !== "");
	if (savable.length === 0)
		throw new Error("No se pudo leer el contenido del álbum");
	await receivedArchive.saveMany(savable.map(archivableFromItem));
	const missing = savable.filter(
		(item) => !receivedArchive.isArchived(item.id),
	).length;
	if (missing > 0)
		throw new Error(
			`No se pudieron guardar ${missing} de ${savable.length} archivos; no se borró nada`,
		);
	try {
		await unshareAlbum({ albumId, profileIds: [ourProfileId] });
	} catch (error) {
		console.error("[received-media] unshare failed", error);
		throw new Error(
			"Grindr no permitió quitar este álbum. Lo guardado en la app sigue intacto.",
			{ cause: error },
		);
	}
	// Grindr may answer OK without doing anything: only call it done when the
	// album really stopped being readable.
	const stillThere = await getAlbumContent(albumId).then(
		(album) => album.content.length > 0,
		() => false,
	);
	if (stillThere)
		throw new Error(
			"Grindr aceptó el pedido pero el álbum sigue ahí. Lo guardado en la app sigue intacto.",
		);
}

export async function loadReceivedMedia({
	conversationId,
	ourProfileId,
}: {
	conversationId: string;
	ourProfileId: number;
}): Promise<ReceivedMediaResult> {
	let page: Awaited<ReturnType<typeof getConversationMessages>>;
	try {
		page = await getConversationMessages({ conversationId });
	} catch (error) {
		// The conversation may be gone; still show what we saved from it.
		const saved = archivedOnlyItems(conversationId, new Set());
		if (saved.length === 0) throw error;
		const profileId = saved.find((item) => item.profileId !== null)
			?.profileId;
		const person = receivedArchive
			.savedPeople()
			.find((entry) => entry.conversationId === conversationId);
		return {
			profile:
				typeof profileId === "number"
					? {
							profileId,
							name: person?.name ?? null,
							distance: null,
							mediaHash: person?.mediaHash ?? null,
						}
					: null,
			items: saved,
		};
	}
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
					rawUrl: url,
					thumbUrl: proxyMediaUrl(url, { as: "image" }) ?? url,
					contentType: "image/jpeg",
					albumId: null,
					name: null,
					timestamp: ts,
					available: true,
					source: "direct",
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
					rawUrl: url,
					thumbUrl: proxyMediaUrl(url, { as: "video" }) ?? url,
					contentType: message.body.contentType ?? "video/mp4",
					albumId: null,
					name: null,
					timestamp: ts,
					available: true,
					source: "direct",
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
						profileId:
							message.body.ownerProfileId ?? profile.profileId,
						timestamp: ts,
					}),
				);
				break;
			}
			default:
				break;
		}
	}

	const [fromAlbums, profilePhotos] = await Promise.all([
		Promise.all(albumJobs).then((lists) => lists.flat()),
		profilePhotoItems(conversationId, profile.profileId),
	]);
	const items = [...direct, ...fromAlbums, ...profilePhotos]
		.filter((item) => item.url !== "")
		.sort((a, b) => b.timestamp - a.timestamp);

	// De-duplicate in case the same media appears twice in the window.
	const byId = new Map<string, ReceivedItem>();
	for (const item of items) if (!byId.has(item.id)) byId.set(item.id, item);

	const live = [...byId.values()];
	return {
		profile,
		items: [
			...live,
			...archivedOnlyItems(conversationId, new Set(byId.keys())),
		],
	};
}
