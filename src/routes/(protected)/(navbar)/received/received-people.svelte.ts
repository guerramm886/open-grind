// Loads the inbox and keeps ONLY the people who sent you photos, videos or
// albums (incoming, not what you sent them). Each conversation is probed with a
// cheap detector; senders are revealed as they're confirmed. Sort and filters
// (favorites, age) apply on top.

import { getConversations } from "$lib/api/messaging/conversations";
import { getProfile } from "$lib/api/users/profiles";
import { detectIncomingMedia } from "$lib/received/received-media";
import type { Conversation } from "$lib/model/messaging/conversations";

export type ReceivedSort = "recent" | "distance";

export type Person = {
	conversationId: string;
	profileId: number;
	name: string;
	mediaHash: string | null;
	distance: number | null;
	favorite: boolean;
	lastActivity: number;
};

function personFromConversation(entry: Conversation): Person | null {
	const data = entry.data;
	const other = data.participants[0];
	if (!other) return null;
	return {
		conversationId: data.conversationId,
		profileId: other.profileId,
		name: data.name,
		mediaHash: other.primaryMediaHash ?? null,
		distance: other.distanceMetres ?? null,
		favorite: data.favorite,
		lastActivity: data.lastActivityTimestamp,
	};
}

const SCAN_CONCURRENCY = 4;
const TARGET_SENDERS = 18;
const MAX_PAGES = 10;

export class ReceivedPeople {
	/** Only confirmed senders. */
	senders = $state<Person[]>([]);
	scanning = $state(false);
	error = $state<Error | null>(null);
	hasMore = $state(true);

	sort = $state<ReceivedSort>("recent");
	favoritesOnly = $state(false);
	ageFilterOn = $state(false);
	ageMin = $state(18);
	ageMax = $state(99);

	ages = $state<Record<number, number | null>>({});

	readonly #ourProfileId: number;
	#page = 1;
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- membership check, not reactive
	#seen = new Set<string>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- in-flight guard, not reactive
	#ageInFlight = new Set<number>();

	constructor(ourProfileId: number) {
		this.#ourProfileId = ourProfileId;
		void this.scanMore();
	}

	/** Load and probe pages until enough senders are found or the inbox ends. */
	async scanMore(): Promise<void> {
		if (this.scanning || !this.hasMore) return;
		this.scanning = true;
		try {
			let pages = 0;
			const start = this.senders.length;
			while (
				this.hasMore &&
				pages < MAX_PAGES &&
				this.senders.length - start < TARGET_SENDERS
			) {
				await this.#loadAndProbePage();
				pages += 1;
			}
		} catch (error) {
			this.error =
				error instanceof Error ? error : new Error(String(error));
		} finally {
			this.scanning = false;
		}
	}

	async #loadAndProbePage(): Promise<void> {
		const result = await getConversations({ page: this.#page });
		this.hasMore = result.nextPage !== null;
		this.#page = result.nextPage ?? this.#page;

		const candidates: Person[] = [];
		for (const entry of result.entries) {
			const person = personFromConversation(entry);
			if (!person || this.#seen.has(person.conversationId)) continue;
			this.#seen.add(person.conversationId);
			candidates.push(person);
		}
		await this.#probe(candidates);
		this.error = null;
	}

	async #probe(candidates: Person[]): Promise<void> {
		const queue = [...candidates];
		const worker = async () => {
			for (;;) {
				const person = queue.shift();
				if (!person) return;
				try {
					const hasMedia = await detectIncomingMedia({
						conversationId: person.conversationId,
						ourProfileId: this.#ourProfileId,
					});
					if (hasMedia) this.senders.push(person);
				} catch {
					/* skip unreadable conversations */
				}
			}
		};
		await Promise.all(
			Array.from({ length: SCAN_CONCURRENCY }, () => worker()),
		);
	}

	ensureAge(profileId: number): void {
		if (profileId in this.ages || this.#ageInFlight.has(profileId)) return;
		this.#ageInFlight.add(profileId);
		void getProfile(profileId)
			.then((profile) => {
				this.ages = { ...this.ages, [profileId]: profile.age };
			})
			.catch(() => {
				this.ages = { ...this.ages, [profileId]: null };
			})
			.finally(() => this.#ageInFlight.delete(profileId));
	}

	get visible(): Person[] {
		let list = this.senders;
		if (this.favoritesOnly) list = list.filter((p) => p.favorite);
		if (this.ageFilterOn) {
			for (const p of list) this.ensureAge(p.profileId);
			list = list.filter((p) => {
				const age = this.ages[p.profileId];
				return (
					age !== null &&
					age !== undefined &&
					age >= this.ageMin &&
					age <= this.ageMax
				);
			});
		}
		const sorted = [...list];
		if (this.sort === "distance") {
			sorted.sort((a, b) => {
				if (a.distance === null) return 1;
				if (b.distance === null) return -1;
				return a.distance - b.distance;
			});
		} else {
			sorted.sort((a, b) => b.lastActivity - a.lastActivity);
		}
		return sorted;
	}
}
