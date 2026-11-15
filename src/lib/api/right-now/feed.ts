import z from "zod";

import { fetchRest } from "$lib/api/transport";

const mediaDataSchema = z
	.object({
		thumbnailUrl: z.string().nullish(),
		fullImageUrl: z.string().nullish(),
	})
	.nullish();

const postDataSchema = z.object({
	profileId: z.number(),
	mediaHash: z.string().nullish(),
	displayName: z.string().nullish(),
	media: z
		.array(z.object({ type: z.string(), data: mediaDataSchema }))
		.nullish(),
	onlineUntil: z.number().nullish(),
	text: z.string().nullish(),
	distance: z.number().nullish(),
	hosting: z.boolean().nullish(),
	// Not confirmed that the feed sends it; when it does, the star starts lit.
	isFavorite: z.boolean().nullish(),
	posted: z.number().nullish(),
});

// The feed mixes post kinds (plus upsell/curated inserts); tolerate unknown
// shapes and keep only the real posts.
const feedSchema = z.object({
	items: z
		.array(z.object({ type: z.string(), data: z.unknown() }))
		.default([]),
	viewerCount: z.number().nullish(),
});

export type RightNowPost = z.infer<typeof postDataSchema> & {
	feedType: string;
	locked: boolean;
};

export type RightNowSort = "DISTANCE" | "NEWEST";

export async function getRightNowFeed({
	sort = "DISTANCE",
	hosting,
	positions,
	ageMin,
	ageMax,
}: {
	sort?: RightNowSort;
	hosting?: boolean;
	/** Sexual position ids; -1 means "not specified". Several = any of them. */
	positions?: number[];
	ageMin?: number;
	ageMax?: number;
} = {}): Promise<RightNowPost[]> {
	const params = new URLSearchParams();
	params.set("sort", sort);
	if (hosting !== undefined) params.set("hosting", String(hosting));
	if (positions && positions.length > 0)
		params.set("sexualPositions", positions.join(","));
	if (ageMin !== undefined) params.set("ageMin", String(ageMin));
	if (ageMax !== undefined) params.set("ageMax", String(ageMax));
	const feed = await fetchRest(
		`/v5/rightnow/feed?${params.toString()}`,
	).then((res) => res.jsonParsed(feedSchema));
	const posts: RightNowPost[] = [];
	for (const item of feed.items) {
		if (item.type !== "right_now_post_v3" && item.type !== "locked_post_v1")
			continue;
		const parsed = postDataSchema.safeParse(item.data);
		if (parsed.success)
			posts.push({
				...parsed.data,
				feedType: item.type,
				locked: item.type === "locked_post_v1",
			});
	}
	return posts;
}
