// Loads the inbox and keeps ONLY the people who sent you photos, videos or
// albums (incoming, not what you sent them). Each conversation is probed with a
// cheap detector; senders are revealed as they're confirmed. Sort and filters
// (favorites, age) apply on top.

import { accountScoped } from "$lib/api/account-caches";
import { getConversations } from "$lib/api/messaging/conversations";
import { getSharedAlbumsFeed } from "$lib/api/messaging/shared-albums-feed";
import { getProfile } from "$lib/api/users/profiles";
import { swipeDecisions } from "$lib/grid/swipe-decisions.svelte";
import { receivedArchive } from "$lib/received/archive.svelte";
import { conversationIdWith } from "$lib/received/favorite-albums";
import {
	archivableFromItem,
	detectReceivedMedia,
	loadReceivedMedia,
} from "$lib/received/received-media";
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
	/** Online while this is in the future (a stored boolean would go stale). */
	onlineUntil: number;
	hasAlbum: boolean;
	hasDirect: boolean;
	/** Has an album that is still stored on Grindr's side (counts to the limit). */
	albumInApi: boolean;
	/** When their newest photo/video/album was sent in the chat (0 = unknown). */
	mediaAt: number;
};

function normalize(text: string): string {
	return text
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase();
}

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
		onlineUntil: other.onlineUntil ?? 0,
		hasAlbum: false,
		hasDirect: false,
		albumInApi: false,
		mediaAt: 0,
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
	onlineOnly = $state(false);
	/** Only people with an album still stored on Grindr (the yellow light). */
	inApiOnly = $state(false);
	ageFilterOn = $state(false);
	ageMin = $state(18);
	ageMax = $state(99);
	/** Name filter typed in the search box (not remembered). */
	search = $state("");

	ages = $state<Record<number, number | null>>({});
	// Conversations whose gallery loaded with no available sent content — hidden
	// from the grid, but re-checked on refresh (availability is dynamic).
	#empty = $state<Record<string, true>>({});

	readonly #ourProfileId: number;
	readonly #prefsKey: string;
	readonly #emptyKey: string;
	readonly #sendersKey: string;
	#page = 1;
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- membership check, not reactive
	#seen = new Set<string>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- in-flight guard, not reactive
	#ageInFlight = new Set<number>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- once-per-session guard, not reactive
	#albumArchivedFor = new Set<string>();

	constructor(ourProfileId: number) {
		this.#ourProfileId = ourProfileId;
		this.#prefsKey = `received-prefs-${ourProfileId}`;
		this.#emptyKey = `received-empty-${ourProfileId}`;
		this.#sendersKey = `received-senders-${ourProfileId}`;
		this.#loadPrefs();
		this.#loadEmpty();
		this.#loadSenders();
		// Fill in / refresh in the background; the cached list shows instantly.
		void this.scanMore();
		// People cached by an older version have no send date yet.
		void this.#recheck(this.senders.filter((p) => p.mediaAt === 0)).then(
			() => this.#syncSharedAlbums(),
		);
	}

	// Grindr's own list of albums shared with us. It finds people whose album
	// message is too far back in the chat for the scan to see (typical of an
	// album that was just unlocked by freeing a slot), and it is the truth
	// about who still has an album stored on Grindr (the yellow dot).
	async #syncSharedAlbums(): Promise<void> {
		let albums: Awaited<ReturnType<typeof getSharedAlbumsFeed>>;
		try {
			albums = await getSharedAlbumsFeed({ favoritesOnly: false });
		} catch (error) {
			console.error("[received] shared albums feed failed", error);
			return;
		}
		// An empty answer may just mean the feed isn't what we expect: don't
		// turn everyone's dot off because of it.
		if (albums.length === 0) return;
		const open = new Map<number, string | null>();
		for (const album of albums)
			if (album.viewable) open.set(album.ownerProfileId, album.ownerName);

		for (const person of this.senders)
			person.albumInApi = open.has(person.profileId);

		const cleared = { ...this.#empty };
		let emptyChanged = false;
		for (const [profileId, name] of open) {
			if (swipeDecisions.isNope(profileId)) continue;
			const conversationId = conversationIdWith({
				ourProfileId: this.#ourProfileId,
				profileId,
			});
			if (cleared[conversationId]) {
				delete cleared[conversationId];
				emptyChanged = true;
			}
			const known = this.senders.find(
				(p) => p.conversationId === conversationId,
			);
			if (known) {
				known.hasAlbum = true;
				void this.#archiveAlbums(known);
				continue;
			}
			const saved = receivedArchive
				.savedPeople()
				.find((entry) => entry.conversationId === conversationId);
			const person: Person = {
				conversationId,
				profileId,
				name: name ?? saved?.name ?? "",
				mediaHash: saved?.mediaHash ?? null,
				distance: null,
				favorite: false,
				lastActivity: 0,
				onlineUntil: 0,
				hasAlbum: true,
				hasDirect: false,
				albumInApi: true,
				mediaAt: saved?.lastSentAt ?? 0,
			};
			this.#seen.add(conversationId);
			this.senders.push(person);
			void this.#archiveAlbums(person);
		}
		if (emptyChanged) {
			this.#empty = cleared;
			this.#persistEmpty();
		}
		this.#persistSenders();
	}

	// Remember the scanned senders so reopening the app shows them at once
	// instead of probing every conversation again. A background scan then adds
	// any new ones.
	#loadSenders(): void {
		try {
			const raw = localStorage.getItem(this.#sendersKey);
			const list: unknown = raw ? JSON.parse(raw) : [];
			if (!Array.isArray(list)) return;
			const cached = list
				.filter(
					(person): person is Partial<Person> & Person =>
						typeof person === "object" &&
						person !== null &&
						typeof (person as Person).conversationId === "string" &&
						typeof (person as Person).profileId === "number",
				)
				.map(
					(person): Person => ({
						...person,
						onlineUntil:
							typeof person.onlineUntil === "number"
								? person.onlineUntil
								: 0,
						albumInApi:
							typeof person.albumInApi === "boolean"
								? person.albumInApi
								: person.hasAlbum,
						mediaAt:
							typeof person.mediaAt === "number" ? person.mediaAt : 0,
					}),
				);
			this.senders = cached;
			// Don't re-probe people we already know; the scan looks for new ones.
			for (const person of cached) this.#seen.add(person.conversationId);
		} catch {
			/* ignore unreadable cache */
		}
	}

	#persistSenders(): void {
		try {
			localStorage.setItem(
				this.#sendersKey,
				JSON.stringify(this.senders),
			);
		} catch {
			/* storage full or unavailable */
		}
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

	/**
	 * Look for new people and re-check the known ones, WITHOUT emptying the
	 * list: nobody disappears while it works.
	 */
	refresh(): void {
		this.#empty = {};
		this.#persistEmpty();
		this.#page = 1;
		this.hasMore = true;
		this.error = null;
		void this.scanMore();
		// A refresh must also re-save albums that changed since last time.
		this.#albumArchivedFor.clear();
		void this.#recheck([...this.senders]).then(() =>
			this.#syncSharedAlbums(),
		);
	}

	// Update what a known person has (album still on Grindr, last send date).
	// Never removes anyone: a failed or empty check leaves the person as is.
	async #recheck(list: Person[]): Promise<void> {
		const queue = [...list];
		const worker = async () => {
			for (;;) {
				const person = queue.shift();
				if (!person) return;
				try {
					const kinds = await detectReceivedMedia({
						conversationId: person.conversationId,
						ourProfileId: this.#ourProfileId,
					});
					person.albumInApi = kinds.hasAlbum;
					if (kinds.hasAlbum) person.hasAlbum = true;
					if (kinds.hasDirect) person.hasDirect = true;
					if (kinds.mediaAt > 0) person.mediaAt = kinds.mediaAt;
				} catch {
					/* keep what we knew */
				}
			}
		};
		await Promise.all(
			Array.from({ length: SCAN_CONCURRENCY }, () => worker()),
		);
		this.#persistSenders();
	}

	/** Called by a person's gallery with what it just saw live. */
	noteGallery(
		conversationId: string,
		seen: { albumInApi: boolean; mediaAt: number },
	): void {
		const person = this.senders.find(
			(p) => p.conversationId === conversationId,
		);
		if (!person) return;
		if (
			person.albumInApi === seen.albumInApi &&
			(seen.mediaAt === 0 || person.mediaAt === seen.mediaAt)
		)
			return;
		person.albumInApi = seen.albumInApi;
		if (seen.mediaAt > 0) person.mediaAt = seen.mediaAt;
		this.#persistSenders();
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
				onlineOnly: boolean;
				inApiOnly: boolean;
				ageFilterOn: boolean;
				ageMin: number;
				ageMax: number;
			}>;
			if (p.sort === "recent" || p.sort === "distance")
				this.sort = p.sort;
			if (typeof p.favoritesOnly === "boolean")
				this.favoritesOnly = p.favoritesOnly;
			if (typeof p.onlineOnly === "boolean")
				this.onlineOnly = p.onlineOnly;
			if (typeof p.inApiOnly === "boolean") this.inApiOnly = p.inApiOnly;
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
					onlineOnly: this.onlineOnly,
					inApiOnly: this.inApiOnly,
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
			if (!person) continue;
			if (this.#seen.has(person.conversationId)) {
				// Already known: just freshen what changes over time.
				const known = this.senders.find(
					(p) => p.conversationId === person.conversationId,
				);
				if (known) {
					known.name = person.name;
					known.mediaHash = person.mediaHash;
					known.distance = person.distance;
					known.favorite = person.favorite;
					known.lastActivity = person.lastActivity;
					known.onlineUntil = person.onlineUntil;
				}
				continue;
			}
			this.#seen.add(person.conversationId);
			candidates.push(person);
		}
		await this.#probe(candidates);
		this.error = null;
		this.#persistSenders();
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
						person.albumInApi = kinds.hasAlbum;
						person.mediaAt = kinds.mediaAt;
						this.senders.push(person);
						// Albums get locked by Grindr's 5-album limit, so save a
						// copy as soon as we see one, before it disappears.
						if (kinds.hasAlbum) void this.#archiveAlbums(person);
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

	// Keep a copy of this person's album photos while they're still viewable.
	async #archiveAlbums(person: Person): Promise<void> {
		if (this.#albumArchivedFor.has(person.conversationId)) return;
		this.#albumArchivedFor.add(person.conversationId);
		try {
			const { items } = await loadReceivedMedia({
				conversationId: person.conversationId,
				ourProfileId: this.#ourProfileId,
			});
			const albumImages = items.filter(
				(item) =>
					item.source === "album" &&
					item.kind === "image" &&
					item.available,
			);
			if (albumImages.length === 0) return;
			receivedArchive.notePerson(person.conversationId, {
				name: person.name,
				mediaHash: person.mediaHash,
				lastActivity: person.mediaAt > 0 ? person.mediaAt : undefined,
			});
			await receivedArchive.saveMany(albumImages.map(archivableFromItem));
		} catch {
			/* best effort */
		}
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
		// Keep anyone whose media we've saved locally, even if Grindr locked
		// their album or they vanished — otherwise you'd lose access to photos
		// you already have. Merge them in if the live scan didn't surface them.
		for (const saved of receivedArchive.savedPeople()) {
			if (saved.profileId === null) continue;
			if (swipeDecisions.isNope(saved.profileId)) continue;
			if (list.some((p) => p.conversationId === saved.conversationId))
				continue;
			list.push({
				conversationId: saved.conversationId,
				profileId: saved.profileId,
				name: saved.name ?? "",
				mediaHash: saved.mediaHash,
				distance: null,
				favorite: false,
				lastActivity: 0,
				onlineUntil: 0,
				hasAlbum: saved.hasAlbum,
				hasDirect: saved.hasDirect,
				albumInApi: false,
				// When it was sent, never when it was saved; unknown sorts last.
				mediaAt: saved.lastSentAt || (saved.lastActivity ?? 0),
			});
		}
		const query = normalize(this.search.trim());
		if (query !== "")
			list = list.filter((p) => normalize(p.name).includes(query));
		if (this.favoritesOnly) list = list.filter((p) => p.favorite);
		if (this.inApiOnly) list = list.filter((p) => p.albumInApi);
		if (this.onlineOnly) {
			const now = Date.now();
			list = list.filter((p) => p.onlineUntil > now);
		}
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
			// By when they SENT the media, not by chat activity or save time.
			const key = (p: Person) => p.mediaAt || p.lastActivity;
			sorted.sort((a, b) => key(b) - key(a));
		}
		return sorted;
	}
}

// Account-scoped so the scanned senders and the chosen sort/filters survive
// navigating into a profile and back.
export const getReceivedPeople = accountScoped(
	(profileId) => new ReceivedPeople(profileId),
);
