import type { GridProfile } from "./grid";

// Local decisions kept on this device.
// "Cross" hides a profile from the grid; "later" only lasts for this session.
// The heart is Grindr's real favorite (handled server-side, not here).

const STORAGE_KEY = "crossed-profiles-v1";

function load(): Record<number, true> {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? (JSON.parse(raw) as Record<number, true>) : {};
	} catch {
		return {};
	}
}

export type DecisionAction = { id: number; action: "cross" | "favorite" };

class SwipeDecisions {
	#crossed: Record<number, true> = $state.raw(load());
	// Most recent decisions, for the "undo" button (session only).
	#history: DecisionAction[] = $state.raw([]);

	isNope(id: number): boolean {
		return this.#crossed[id] === true;
	}

	get canUndo(): boolean {
		return this.#history.length > 0;
	}

	#persist(): void {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#crossed));
		} catch (error) {
			console.error(error);
		}
	}

	record(entry: DecisionAction): void {
		this.#history = [...this.#history, entry];
	}

	undo(): DecisionAction | null {
		const last = this.#history.at(-1);
		if (last === undefined) return null;
		this.#history = this.#history.slice(0, -1);
		return last;
	}

	cross(id: number): void {
		this.#crossed = { ...this.#crossed, [id]: true };
		this.#persist();
	}

	uncross(id: number): void {
		const { [id]: _removed, ...rest } = this.#crossed;
		this.#crossed = rest;
		this.#persist();
	}

	#isUndecided(profile: GridProfile): boolean {
		return (
			profile.type === "rendered" &&
			!this.isNope(profile.id) &&
			!profile.isFavorite
		);
	}

	// The nearest profile still to decide (grid is already distance-sorted):
	// not crossed and not already a Grindr favorite. Used to enter the chooser.
	nextNearestUndecided(
		profiles: readonly GridProfile[],
		excludeId?: number,
	): number | null {
		for (const profile of profiles) {
			if (profile.id === excludeId) continue;
			if (this.#isUndecided(profile)) return profile.id;
		}
		return null;
	}

	// The next profile to decide AFTER the current one, so marking one always
	// moves forward (toward farther profiles), never back to one already seen.
	// Call it before crossing, since a cross removes the current from the list.
	nextUndecidedAfter(
		profiles: readonly GridProfile[],
		currentId: number,
	): number | null {
		const index = profiles.findIndex((profile) => profile.id === currentId);
		const start = index === -1 ? 0 : index + 1;
		for (let i = start; i < profiles.length; i++) {
			const profile = profiles[i];
			if (profile && this.#isUndecided(profile)) return profile.id;
		}
		return null;
	}
}

export const swipeDecisions = new SwipeDecisions();
