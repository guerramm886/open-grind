// Loads the inbox as a list of people for the "Recibidos" grid, with its own
// paging (independent of the chat inbox state) plus sort and filters. Ages are
// fetched lazily and only while the age filter is active.

import { getConversations } from "$lib/api/messaging/conversations";
import { getProfile } from "$lib/api/users/profiles";
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

export class ReceivedPeople {
	people = $state<Person[]>([]);
	loading = $state(false);
	error = $state<Error | null>(null);
	hasMore = $state(true);

	sort = $state<ReceivedSort>("recent");
	favoritesOnly = $state(false);
	ageFilterOn = $state(false);
	ageMin = $state(18);
	ageMax = $state(99);

	ages = $state<Record<number, number | null>>({});

	#page = 1;
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- membership check, not reactive
	#seen = new Set<string>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- in-flight guard, not reactive
	#ageInFlight = new Set<number>();

	constructor() {
		void this.loadMore();
	}

	async loadMore(): Promise<void> {
		if (this.loading || !this.hasMore) return;
		this.loading = true;
		try {
			const result = await getConversations({ page: this.#page });
			for (const entry of result.entries) {
				const person = personFromConversation(entry);
				if (!person || this.#seen.has(person.conversationId)) continue;
				this.#seen.add(person.conversationId);
				this.people.push(person);
			}
			this.hasMore = result.nextPage !== null;
			this.#page = result.nextPage ?? this.#page;
			this.error = null;
		} catch (error) {
			this.error =
				error instanceof Error ? error : new Error(String(error));
		} finally {
			this.loading = false;
		}
	}

	ensureAge(profileId: number): void {
		if (
			profileId in this.ages ||
			this.#ageInFlight.has(profileId)
		)
			return;
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
		let list = this.people;
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
