import { filterPositionSchema } from "$lib/model/browse/grid/filters";
import {
	type ConversationFilterValues,
	defaultConversationFilters,
} from "$lib/model/messaging/conversation-filters";
import { deepEqual } from "$lib/util/deep-equal";
import type { InboxFilterRequest } from "$lib/api/messaging/conversations";
import type { Conversation } from "$lib/model/messaging/conversations";

export function inboxFilterRequest(
	values: ConversationFilterValues,
): InboxFilterRequest | null {
	if (deepEqual(values, defaultConversationFilters)) return null;
	return {
		unreadOnly: values.unread,
		chemistryOnly: false,
		favoritesOnly: values.favorites,
		rightNowOnly: values.rightNow,
		onlineNowOnly: values.online,
		distanceMeters: values.distanceMetres,
		positions: [...values.positions],
	};
}

export class ConversationFilters {
	value = $state<ConversationFilterValues>({ ...defaultConversationFilters });
	#storageKey: string | null;

	constructor(profileId?: number) {
		this.#storageKey =
			profileId === undefined ? null : `conversation-filters-${profileId}`;
		if (!this.#storageKey) return;
		try {
			const stored = JSON.parse(
				localStorage.getItem(this.#storageKey) ?? "null",
			) as Record<string, unknown> | null;
			if (stored && typeof stored === "object") {
				const defaults = defaultConversationFilters;
				this.value = {
					favorites: stored.favorites === true,
					unread: stored.unread === true,
					online: stored.online === true,
					rightNow: stored.rightNow === true,
					distanceMetres:
						typeof stored.distanceMetres === "number" &&
						Number.isFinite(stored.distanceMetres)
							? stored.distanceMetres
							: defaults.distanceMetres,
					positions:
						filterPositionSchema.safeParse(stored.positions).data ?? [],
				};
			}
		} catch {
			// Storage can be unavailable or contain invalid data.
		}
	}

	get request(): InboxFilterRequest | null {
		return inboxFilterRequest(this.value);
	}

	get filtered(): boolean {
		return this.request !== null;
	}

	get dropsOnlyReadChats(): boolean {
		return deepEqual(
			{ ...this.value, unread: defaultConversationFilters.unread },
			defaultConversationFilters,
		);
	}

	set(values: Partial<ConversationFilterValues>): boolean {
		const merged = { ...this.value, ...values };
		if (deepEqual(this.value, merged)) return false;
		this.value = merged;
		if (this.#storageKey) {
			try {
				localStorage.setItem(this.#storageKey, JSON.stringify(merged));
			} catch {
				// Filters remain active for this session if storage is unavailable.
			}
		}
		return true;
	}
}

export function applyFavoriteEdit({
	entries,
	profileId,
	isFavorite,
}: {
	entries: Conversation[];
	profileId: number;
	isFavorite: boolean;
}): void {
	const entry = entries.find(
		(candidate) => candidate.data.participants[0]?.profileId === profileId,
	);
	if (entry) entry.data.favorite = isFavorite;
}
