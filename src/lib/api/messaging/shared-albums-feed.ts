// Albums other people shared with us ("pressie" feed). Unlike the chat, this
// lists them without walking every conversation, and it can be narrowed to
// favorites. Fields are parsed leniently: the endpoint is only partly
// documented.

import z from "zod";

import { fetchRest } from "$lib/api/transport";

const sharedAlbumSchema = z.object({
	albumId: z.number(),
	albumViewable: z.boolean().nullish(),
	name: z.string().nullish(),
	ownerProfileId: z.number().nullish(),
	imageCount: z.number().nullish(),
	videoCount: z.number().nullish(),
	hasUnseenContent: z.boolean().nullish(),
	coverContent: z.object({ location: z.string().nullish() }).nullish(),
	profile: z
		.object({
			profileId: z.number().nullish(),
			name: z.string().nullish(),
			onlineUntil: z.number().nullish(),
		})
		.nullish(),
});

const feedSchema = z.object({
	sharedAlbums: z.array(z.unknown()).nullish(),
});

export type SharedAlbum = {
	albumId: number;
	viewable: boolean;
	name: string | null;
	ownerProfileId: number;
	ownerName: string | null;
	imageCount: number;
	videoCount: number;
	hasUnseenContent: boolean;
	coverUrl: string | null;
};

export async function getSharedAlbumsFeed({
	favoritesOnly,
}: {
	favoritesOnly: boolean;
}): Promise<SharedAlbum[]> {
	const feed = await fetchRest("/v3/pressie-albums/feed", {
		method: "POST",
		body: favoritesOnly ? { isFavorite: true } : {},
	}).then((res) => res.jsonParsed(feedSchema));
	const albums: SharedAlbum[] = [];
	for (const raw of feed.sharedAlbums ?? []) {
		const parsed = sharedAlbumSchema.safeParse(raw);
		if (!parsed.success) continue;
		const album = parsed.data;
		const ownerProfileId =
			album.ownerProfileId ?? album.profile?.profileId ?? null;
		if (ownerProfileId === null) continue;
		albums.push({
			albumId: album.albumId,
			viewable: album.albumViewable ?? false,
			name: album.name ?? null,
			ownerProfileId,
			ownerName: album.profile?.name ?? null,
			imageCount: album.imageCount ?? 0,
			videoCount: album.videoCount ?? 0,
			hasUnseenContent: album.hasUnseenContent ?? false,
			coverUrl: album.coverContent?.location ?? null,
		});
	}
	return albums;
}