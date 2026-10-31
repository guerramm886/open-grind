import type { GridProfile } from "./grid";

// Heart / cross decisions, kept on this device only.
// Crossed profiles leave the grid; "later" only lasts for this session.

export type SwipeDecision = "like" | "nope";

const STORAGE_KEY = "swipe-decisions-v1";

function load(): Record<number, SwipeDecision> {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? (JSON.parse(raw) as Record<number, SwipeDecision>) : {};
	} catch {
		return {};
	}
}

class SwipeDecisions {
	#byId: Record<number, SwipeDecision> = $state.raw(load());
	#later: number[] = $state.raw([]);

	decision(id: number): SwipeDecision | null {
		return this.#byId[id] ?? null;
	}

	isNope(id: number): boolean {
		return this.#byId[id] === "nope";
	}

	isLater(id: number): boolean {
		return this.#later.includes(id);
	}

	decide(id: number, decision: SwipeDecision): void {
		this.#byId = { ...this.#byId, [id]: decision };
		this.#later = this.#later.filter((laterId) => laterId !== id);
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#byId));
		} catch (error) {
			console.error(error);
		}
	}

	later(id: number): void {
		this.#later = [...this.#later.filter((laterId) => laterId !== id), id];
	}

	// The nearest profile still to decide (grid is already distance-sorted).
	// Profiles left "for later" fall to the end; crossed ones are gone already.
	nextNearestUndecided(
		profiles: readonly GridProfile[],
		excludeId?: number,
	): number | null {
		let firstLater: number | null = null;
		for (const profile of profiles) {
			if (profile.type !== "rendered") continue;
			if (profile.id === excludeId) continue;
			if (this.decision(profile.id) !== null) continue;
			if (this.isLater(profile.id)) {
				firstLater ??= profile.id;
				continue;
			}
			return profile.id;
		}
		return firstLater;
	}
}

export const swipeDecisions = new SwipeDecisions();
