// Saved combinations of browse filters ("presets"), kept on this device, so you
// can switch between setups with one tap.

import { defaultFilters } from "$lib/model/browse/grid/filters";
import type { GridSearchFilters } from "$lib/model/browse/grid/filters";

const KEY = "filter-presets-v1";

export type FilterPreset = {
	id: string;
	name: string;
	filters: GridSearchFilters;
};

function load(): FilterPreset[] {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return [];
		const list: unknown = JSON.parse(raw);
		if (!Array.isArray(list)) return [];
		return list.filter(
			(item): item is FilterPreset =>
				typeof item === "object" &&
				item !== null &&
				typeof (item as FilterPreset).id === "string" &&
				typeof (item as FilterPreset).name === "string",
		);
	} catch {
		return [];
	}
}

class FilterPresets {
	presets = $state<FilterPreset[]>(load());

	#persist(): void {
		try {
			localStorage.setItem(KEY, JSON.stringify(this.presets));
		} catch (error) {
			console.error(error);
		}
	}

	save(name: string, filters: GridSearchFilters): void {
		const trimmed = name.trim() || "Preset";
		this.presets = [
			...this.presets,
			{
				id: crypto.randomUUID(),
				name: trimmed,
				// Clone so later filter edits don't mutate the stored preset.
				filters: { ...defaultFilters, ...filters },
			},
		];
		this.#persist();
	}

	remove(id: string): void {
		this.presets = this.presets.filter((preset) => preset.id !== id);
		this.#persist();
	}
}

export const filterPresets = new FilterPresets();
