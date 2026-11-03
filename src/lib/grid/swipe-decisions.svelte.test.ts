import { describe, expect, it } from "vitest";
import { rendered } from "./grid-test-helpers";
import { swipeDecisions } from "./swipe-decisions.svelte";

describe("profile decision navigation", () => {
	it("moves right even when the next profile is already a favorite", () => {
		const profiles = [
			rendered({ id: 10001 }),
			rendered({ id: 10002, isFavorite: true }),
			rendered({ id: 10003 }),
		];
		expect(swipeDecisions.nextUndecidedAfter(profiles, 10001)).toBe(10002);
	});
	it("does not jump to the first profile when the current profile is absent", () => {
		expect(
			swipeDecisions.nextUndecidedAfter([rendered({ id: 10001 })], 10009),
		).toBeNull();
	});
});
