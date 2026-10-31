import type { GridProfile } from "./grid";

export function dedupeGridProfiles(
	items: readonly GridProfile[],
): GridProfile[] {
	const byId = new Map<number, GridProfile>();
	for (const item of items) {
		const existing = byId.get(item.id);
		if (
			!existing ||
			(existing.type === "lazy" && item.type === "rendered")
		) {
			byId.set(item.id, item);
		}
	}
	return [...byId.values()];
}

// Nearest first; profiles hiding their distance only show when asked for.
// Lazy profiles stay in both views until they resolve, since resolving
// needs them on screen.
export function distanceView({
	profiles,
	hiddenDistanceOnly,
}: {
	profiles: GridProfile[];
	hiddenDistanceOnly: boolean;
}): GridProfile[] {
	const shown = profiles.filter(
		(profile) =>
			profile.type === "lazy" ||
			(profile.distance === null) === hiddenDistanceOnly,
	);
	if (hiddenDistanceOnly) return shown;
	const distanceOf = (profile: GridProfile) =>
		profile.type === "rendered" ? (profile.distance ?? Infinity) : Infinity;
	return shown.sort((a, b) => distanceOf(a) - distanceOf(b));
}

// Nearest first, keeping profiles with no distance (and lazy ones) at the end.
export function sortByDistance(profiles: GridProfile[]): GridProfile[] {
	const distanceOf = (profile: GridProfile) =>
		profile.type === "rendered" ? (profile.distance ?? Infinity) : Infinity;
	return [...profiles].sort((a, b) => distanceOf(a) - distanceOf(b));
}

export function indexProfilesById(
	profiles: readonly GridProfile[],
): ReadonlyMap<number, number> {
	return new Map(profiles.map((profile, index) => [profile.id, index]));
}
