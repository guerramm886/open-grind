// Heart / cross decisions from the swipe deck, kept on this device only.
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
	open = $state(false);
	// Local filters for the deck only (not sent to the server).
	minAge: number | null = $state(null);
	maxAge: number | null = $state(null);
	maxDistanceKm: number | null = $state(null);
	#byId: Record<number, SwipeDecision> = $state.raw(load());
	#later: number[] = $state.raw([]);

	passesFilters({
		age,
		distanceMeters,
	}: {
		age: number | null | undefined;
		distanceMeters: number | null;
	}): boolean {
		if (this.minAge !== null && (age == null || age < this.minAge))
			return false;
		if (this.maxAge !== null && (age == null || age > this.maxAge))
			return false;
		if (
			this.maxDistanceKm !== null &&
			(distanceMeters === null ||
				distanceMeters > this.maxDistanceKm * 1000)
		)
			return false;
		return true;
	}

	decision(id: number): SwipeDecision | null {
		return this.#byId[id] ?? null;
	}

	isNope(id: number): boolean {
		return this.#byId[id] === "nope";
	}

	laterRank(id: number): number {
		return this.#later.indexOf(id);
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
}

export const swipeDecisions = new SwipeDecisions();
