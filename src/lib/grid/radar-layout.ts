// Layout for the closeness radar: each person sits on the ring for the
// distance Grindr reports. Grindr gives no direction, so the angle is made
// up — stable per person, and nudged so photos don't pile on each other. It
// must never be read as where someone actually is.

export type RadarPerson = { id: number; distance: number };

export type RadarDot = {
	id: number;
	/** Offset from the centre, in pixels. */
	x: number;
	y: number;
	radius: number;
};

export type RadarRing = { distance: number; radius: number };

/** Below this (metres) the scale is roughly linear, above it logarithmic. */
const KNEE_M = 150;

const RING_STEPS_M = [
	100, 250, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000,
	250_000, 500_000, 1_000_000,
];

/** Pixel radius for a distance, given the outermost distance shown. */
export function radiusFor({
	distance,
	maxDistance,
	innerRadius,
	outerRadius,
}: {
	distance: number;
	maxDistance: number;
	innerRadius: number;
	outerRadius: number;
}): number {
	const max = Math.max(maxDistance, 1);
	const share =
		Math.log1p(Math.min(Math.max(distance, 0), max) / KNEE_M) /
		Math.log1p(max / KNEE_M);
	return innerRadius + (outerRadius - innerRadius) * share;
}

/** Labelled rings, spaced so their labels don't collide. */
export function radarRings({
	maxDistance,
	innerRadius,
	outerRadius,
	minGapPx = 26,
}: {
	maxDistance: number;
	innerRadius: number;
	outerRadius: number;
	minGapPx?: number;
}): RadarRing[] {
	const rings: RadarRing[] = [];
	let last = innerRadius;
	for (const step of RING_STEPS_M) {
		if (step >= maxDistance) break;
		const radius = radiusFor({
			distance: step,
			maxDistance,
			innerRadius,
			outerRadius,
		});
		if (radius - last < minGapPx || outerRadius - radius < minGapPx)
			continue;
		rings.push({ distance: step, radius });
		last = radius;
	}
	rings.push({ distance: maxDistance, radius: outerRadius });
	return rings;
}

/** A stable pseudo-random angle (radians) for a profile id. */
function baseAngle(id: number): number {
	// Knuth multiplicative hash, spread over the circle.
	const hashed = Math.imul(id >>> 0, 2654435761) >>> 0;
	return (hashed / 2 ** 32) * Math.PI * 2;
}

/** Photo size that lets `count` photos share a disc of `outerRadius`. */
export function dotSizeFor({
	count,
	outerRadius,
	min = 26,
	max = 44,
}: {
	count: number;
	outerRadius: number;
	min?: number;
	max?: number;
}): number {
	const fitting = Math.sqrt(
		(Math.PI * outerRadius * outerRadius) / (Math.max(count, 1) * 1.6),
	);
	return Math.round(Math.min(max, Math.max(min, fitting)));
}

/** Positions for everyone, nearest first, avoiding overlaps where possible. */
export function layoutRadar({
	people,
	maxDistance,
	innerRadius,
	outerRadius,
	dotSize,
}: {
	people: RadarPerson[];
	maxDistance: number;
	innerRadius: number;
	outerRadius: number;
	dotSize: number;
}): RadarDot[] {
	const placed: RadarDot[] = [];
	const minGap = dotSize * 0.92;
	const sorted = [...people].sort((a, b) => a.distance - b.distance);
	for (const person of sorted) {
		const radius = radiusFor({
			distance: person.distance,
			maxDistance,
			innerRadius,
			outerRadius,
		});
		const start = baseAngle(person.id);
		// Try around the ring first, then a little in or out of it, keeping
		// the spot that overlaps least when nothing is fully clear.
		const shifts = [0, 0.35, -0.35, 0.7, -0.7].map((k) => k * dotSize);
		let best = { x: 0, y: 0, crowding: Number.POSITIVE_INFINITY };
		search: for (const shift of shifts) {
			const r = Math.min(Math.max(radius + shift, innerRadius), outerRadius);
			const step = Math.min(Math.PI / 6, minGap / Math.max(r, 1));
			const tries = Math.min(72, Math.ceil((Math.PI * 2) / step));
			for (let attempt = 0; attempt < tries; attempt += 1) {
				const turn = Math.ceil(attempt / 2) * (attempt % 2 === 0 ? 1 : -1);
				const angle = start + turn * step;
				const x = Math.cos(angle) * r;
				const y = Math.sin(angle) * r;
				let crowding = 0;
				for (const other of placed) {
					const gap = Math.hypot(other.x - x, other.y - y);
					if (gap < minGap) crowding += minGap - gap;
				}
				if (crowding < best.crowding) best = { x, y, crowding };
				if (crowding === 0) break search;
			}
		}
		placed.push({ id: person.id, radius, x: best.x, y: best.y });
	}
	return placed;
}
