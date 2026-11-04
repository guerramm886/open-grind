import { describe, expect, it } from "vitest";
import { rendered } from "./grid-test-helpers";
import { swipeDecisions } from "./swipe-decisions.svelte";

describe("profile decision navigation", () => {
	it("skips favorites and crossed profiles when moving right", () => {
		const profiles = [
			rendered({ id: 10001 }),
			rendered({ id: 10002, isFavorite: true }),
			rendered({ id: 10003 }),
			rendered({ id: 10004 }),
		];
		swipeDecisions.cross(10003);
		try {
			expect(swipeDecisions.nextUndecidedAfter(profiles, 10001)).toBe(10004);
		} finally {
			swipeDecisions.uncross(10003);
		}
	});
	it("returns no next profile when all later profiles are classified", () => {
		const profiles = [
			rendered({ id: 10001 }),
			rendered({ id: 10002, isFavorite: true }),
			rendered({ id: 10003 }),
		];
		swipeDecisions.cross(10003);
		try {
			expect(swipeDecisions.nextUndecidedAfter(profiles, 10001)).toBeNull();
		} finally {
			swipeDecisions.uncross(10003);
		}
	});
	it("does not jump to the first profile when the current profile is absent", () => {
		expect(
			swipeDecisions.nextUndecidedAfter([rendered({ id: 10001 })], 10009),
		).toBeNull();
	});
});
