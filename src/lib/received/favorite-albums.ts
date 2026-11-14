// Keeps a local copy of the albums that FAVORITES shared with us, straight
// from Grindr's shared-albums feed. This catches new content a favorite adds
// to an album even when you haven't opened their chat.

import {
	getSharedAlbumsFeed,
	type SharedAlbum,
} from "$lib/api/messaging/shared-albums-feed";
import { receivedArchive } from "$lib/received/archive.svelte";
import {
	archivableFromItem,
	expandAlbum,
} from "$lib/received/received-media";

/** A 1:1 conversation id is both profile ids, smallest first. */
export function conversationIdWith({
	ourProfileId,
	profileId,
}: {
	ourProfileId: number;
	profileId: number;
}): string {
	return [ourProfileId, profileId].sort((a, b) => a - b).join(":");
}

/** Saves every readable item of one shared album; returns how many were new. */
export async function archiveSharedAlbum({
	album,
	ourProfileId,
}: {
	album: SharedAlbum;
	ourProfileId: number;
}): Promise<number> {
	if (!album.viewable) return 0;
	const conversationId = conversationIdWith({
		ourProfileId,
		profileId: album.ownerProfileId,
	});
	const items = await expandAlbum({
		conversationId,
		albumId: album.albumId,
		profileId: album.ownerProfileId,
		// The feed has no send date; keep whatever date we already knew.
		timestamp: 0,
	});
	const savable = items.filter(
		(item) => item.rawUrl !== "" && !receivedArchive.isArchived(item.id),
	);
	if (savable.length === 0) return 0;
	const known = receivedArchive
		.savedPeople()
		.find((person) => person.conversationId === conversationId);
	receivedArchive.notePerson(conversationId, {
		name: known?.name ?? album.ownerName,
		mediaHash: known?.mediaHash ?? null,
	});
	return receivedArchive.saveMany(savable.map(archivableFromItem));
}

let running: Promise<number> | null = null;

/**
 * Archive what favorites shared (one run at a time). Returns how many new
 * files were saved. Failures are swallowed per album: this is best effort.
 */
export function archiveFavoriteAlbums(ourProfileId: number): Promise<number> {
	running ??= (async () => {
		let saved = 0;
		try {
			const albums = await getSharedAlbumsFeed({ favoritesOnly: true });
			for (const album of albums) {
				try {
					saved += await archiveSharedAlbum({ album, ourProfileId });
				} catch (error) {
					console.error("[favorite-albums] album failed", error);
				}
			}
		} catch (error) {
			console.error("[favorite-albums] feed failed", error);
		} finally {
			running = null;
		}
		return saved;
	})();
	return running;
}