// Loads the inbox and keeps ONLY the people who sent you photos, videos or
// albums (incoming, not what you sent them). Each conversation is probed with a
// cheap detector; senders are revealed as they're confirmed. Sort and filters
// (favorites, age) apply on top.

import { accountScoped } from "$lib/api/account-caches";
import { getConversations } from "$lib/api/messaging/conversations";
import { getProfile } from "$lib/api/users/profiles";
import { swipeDecisions } from "$lib/grid/swipe-decisions.svelte";
import { detectReceivedMedia } from "$lib/received/received-media";
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
	hasAlbum: boolean;
	hasDirect: boolean;
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
		hasAlbum: false,
		hasDirect: false,
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
	// Conversations whose gallery loaded with no available sent content — hidden
	// from the grid, but re-checked on refresh (availability is dynamic).
	#empty = $state<Record<string, true>>({});

	readonly #ourProfileId: number;
	readonly #prefsKey: string;
	readonly #emptyKey: string;
	#page = 1;
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- membership check, not reactive
	#seen = new Set<string>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- in-flight guard, not reactive
	#ageInFlight = new Set<number>();

	constructor(ourProfileId: number) {
		this.#ourProfileId = ourProfileId;
		this.#prefsKey = `received-prefs-${ourProfileId}`;
		this.#emptyKey = `received-empty-${ourProfileId}`;
		this.#loadPrefs();
		this.#loadEmpty();
		void this.scanMore();
	}

	#loadEmpty(): void {
		try {
			const raw = localStorage.getItem(this.#emptyKey);
			const list: unknown = raw ? JSON.parse(raw) : [];
			if (Array.isArray(list)) {
				const next: Record<string, true> = {};
				for (const id of list)
					if (typeof id === "string") next[id] = true;
				this.#empty = next;
			}
		} catch {
			/* ignore */
		}
	}

	#persistEmpty(): void {
		try {
			localStorage.setItem(
				this.#emptyKey,
				JSON.stringify(Object.keys(this.#empty)),
			);
		} catch {
			/* ignore */
		}
	}

	/** Called by a person's gallery when it loads with no sent content. */
	markEmpty(conversationId: string): void {
		if (this.#empty[conversationId]) return;
		this.#empty = { ...this.#empty, [conversationId]: true };
		this.#persistEmpty();
	}

	/** Called by a person's gallery when it does have sent content. */
	markHasContent(conversationId: string): void {
		if (!this.#empty[conversationId]) return;
		const next = { ...this.#empty };
		delete next[conversationId];
		this.#empty = next;
		this.#persistEmpty();
	}

	/** Re-check everyone from scratch (availability can change in Grindr). */
	refresh(): void {
		this.#empty = {};
		this.#persistEmpty();
		this.senders = [];
		this.#seen.clear();
		this.#page = 1;
		this.hasMore = true;
		this.error = null;
		void this.scanMore();
	}

	// The instance is account-scoped (survives navigation), and prefs are also
	// mirrored to localStorage so the chosen sort/filters outlast a restart.
	#loadPrefs(): void {
		try {
			const raw = localStorage.getItem(this.#prefsKey);
			if (!raw) return;
			const p = JSON.parse(raw) as Partial<{
				sort: ReceivedSort;
				favoritesOnly: boolean;
				ageFilterOn: boolean;
				ageMin: number;
				ageMax: number;
			}>;
			if (p.sort === "recent" || p.sort === "distance")
				this.sort = p.sort;
			if (typeof p.favoritesOnly === "boolean")
				this.favoritesOnly = p.favoritesOnly;
			if (typeof p.ageFilterOn === "boolean")
				this.ageFilterOn = p.ageFilterOn;
			if (typeof p.ageMin === "number") this.ageMin = p.ageMin;
			if (typeof p.ageMax === "number") this.ageMax = p.ageMax;
		} catch {
			/* ignore unreadable prefs */
		}
	}

	savePrefs(): void {
		try {
			localStorage.setItem(
				this.#prefsKey,
				JSON.stringify({
					sort: this.sort,
					favoritesOnly: this.favoritesOnly,
					ageFilterOn: this.ageFilterOn,
					ageMin: this.ageMin,
					ageMax: this.ageMax,
				}),
			);
		} catch {
			/* storage unavailable */
		}
	}

	destroy(): void {
		/* nothing to tear down; kept for accountScoped */
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
					const kinds = await detectReceivedMedia({
						conversationId: person.conversationId,
						ourProfileId: this.#ourProfileId,
					});
					if (kinds.hasAlbum || kinds.hasDirect) {
						person.hasAlbum = kinds.hasAlbum;
						person.hasDirect = kinds.hasDirect;
						this.senders.push(person);
					}
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
		// Crossed-out people are hidden everywhere, like a block; so are people
		// confirmed to have no available content.
		let list = this.senders.filter(
			(p) =>
				!swipeDecisions.isNope(p.profileId) &&
				!this.#empty[p.conversationId],
		);
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

// Account-scoped so the scanned senders and the chosen sort/filters survive
// navigating into a profile and back.
export const getReceivedPeople = accountScoped(
	(profileId) => new ReceivedPeople(profileId),
);
