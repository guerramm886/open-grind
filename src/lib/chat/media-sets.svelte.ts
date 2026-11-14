// Local "sets" of photos: named groups of your reusable drawer media that you
// can fire off all at once to any chat. The photos themselves live in Grindr's
// media drawer (so they survive a reinstall and can be re-sent); only the
// grouping and order are kept on this device.

import type { DrawerMedia } from "$lib/api/messaging/drawer";

const KEY = "media-sets-v1";

export type MediaSet = {
	id: string;
	name: string;
	items: DrawerMedia[];
};

function load(): MediaSet[] {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return [];
		const value: unknown = JSON.parse(raw);
		return Array.isArray(value) ? (value as MediaSet[]) : [];
	} catch {
		return [];
	}
}

class MediaSets {
	sets = $state<MediaSet[]>(load());

	#persist(): void {
		try {
			localStorage.setItem(KEY, JSON.stringify(this.sets));
		} catch (error) {
			console.error(error);
		}
	}

	create(name: string): MediaSet {
		const set: MediaSet = {
			id: crypto.randomUUID(),
			name: name.trim() || "Set sin nombre",
			items: [],
		};
		this.sets = [...this.sets, set];
		this.#persist();
		return set;
	}

	rename(id: string, name: string): void {
		this.sets = this.sets.map((set) =>
			set.id === id ? { ...set, name: name.trim() || set.name } : set,
		);
		this.#persist();
	}

	remove(id: string): void {
		this.sets = this.sets.filter((set) => set.id !== id);
		this.#persist();
	}

	setItems(id: string, items: DrawerMedia[]): void {
		this.sets = this.sets.map((set) =>
			set.id === id ? { ...set, items } : set,
		);
		this.#persist();
	}
}

export const mediaSets = new MediaSets();
