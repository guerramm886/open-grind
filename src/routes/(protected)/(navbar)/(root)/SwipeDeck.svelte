<script lang="ts">
	import { goto } from "$app/navigation";
	import ClockIcon from "phosphor-svelte/lib/ClockIcon";
	import HeartIcon from "phosphor-svelte/lib/HeartIcon";
	import XIcon from "phosphor-svelte/lib/XIcon";

	import DisplayName from "$lib/components/profile/DisplayName.svelte";
	import DistanceFormatted from "$lib/components/profile/DistanceFormatted.svelte";
	import { Button } from "$lib/components/ui/button";
	import type { RenderedGridProfile } from "$lib/grid/grid";
	import { gridState } from "$lib/grid/grid-state.svelte";
	import {
		type SwipeDecision,
		swipeDecisions,
	} from "$lib/grid/swipe-decisions.svelte";
	import { dismissOnBackGesture } from "$lib/platform/back-gesture-event.svelte";
	import { profileMediaUrl } from "$lib/util/media";

	const SWIPE_THRESHOLD_PX = 110;

	const undecided = $derived(
		gridState.profiles.filter(
			(profile) => swipeDecisions.decision(profile.id) === null,
		),
	);
	// Profiles left for later go behind the ones not seen yet.
	const current: RenderedGridProfile | null = $derived(
		undecided
			.filter(
				(profile): profile is RenderedGridProfile =>
					profile.type === "rendered",
			)
			.map((profile, index) => ({
				profile,
				rank:
					swipeDecisions.laterRank(profile.id) === -1
						? index
						: undecided.length + swipeDecisions.laterRank(profile.id),
			}))
			.sort((a, b) => a.rank - b.rank)[0]?.profile ?? null,
	);
	const hasMorePages = $derived(
		gridState.nextPage !== 0 && gridState.nextPage !== null,
	);

	$effect(() => {
		if (!swipeDecisions.open || current !== null) return;
		const lazy = undecided.find((profile) => profile.type === "lazy");
		if (lazy) {
			gridState
				.resolveProfile(lazy.id)
				.catch((error) => console.error(error));
		} else if (hasMorePages && !gridState.paging.running) {
			void gridState.paging.run();
		}
	});

	let dragStartX: number | null = $state(null);
	let dragX = $state(0);

	function decide(decision: SwipeDecision) {
		if (current) swipeDecisions.decide(current.id, decision);
		dragX = 0;
	}

	function later() {
		if (current) swipeDecisions.later(current.id);
		dragX = 0;
	}

	function close() {
		swipeDecisions.open = false;
	}

	function openProfile() {
		if (!current) return;
		const id = current.id;
		close();
		void goto(`/profile/${id}`, { state: { profileOrigin: "browse" } });
	}

	dismissOnBackGesture({
		active: () => swipeDecisions.open,
		dismiss: close,
	});
</script>

{#if swipeDecisions.open}
	<div
		class="fixed inset-0 z-50 flex flex-col gap-4 bg-background px-4 pt-[calc(var(--safe-area-top)+1rem)] pb-[calc(var(--safe-area-bottom)+1.5rem)]"
		role="dialog"
		aria-label="Elegir perfiles"
	>
		<div class="flex items-center justify-between">
			<h2 class="text-lg font-semibold">
				Elegir <span class="neon-text">❤</span>
			</h2>
			<Button variant="secondary" size="icon" aria-label="Cerrar" onclick={close}>
				<XIcon />
			</Button>
		</div>

		{#if current}
			{@const mediaHash = current.profilePhotosHashes?.[0] ?? null}
			<div
				class="relative mx-auto flex min-h-0 w-full max-w-md flex-1 touch-pan-y items-end overflow-hidden rounded-3xl bg-card neon-ring select-none"
				style:transform="translateX({dragX}px) rotate({dragX / 25}deg)"
				style:transition={dragStartX === null ? "transform 200ms" : "none"}
				onpointerdown={(event) => {
					dragStartX = event.clientX;
					(event.currentTarget as HTMLElement).setPointerCapture(
						event.pointerId,
					);
				}}
				onpointermove={(event) => {
					if (dragStartX !== null) dragX = event.clientX - dragStartX;
				}}
				onpointerup={() => {
					const moved = dragX;
					dragStartX = null;
					if (moved > SWIPE_THRESHOLD_PX) decide("like");
					else if (moved < -SWIPE_THRESHOLD_PX) decide("nope");
					else if (Math.abs(moved) < 6) openProfile();
					else dragX = 0;
				}}
				onpointercancel={() => {
					dragStartX = null;
					dragX = 0;
				}}
				role="presentation"
			>
				{#if mediaHash}
					<img
						src={profileMediaUrl({ mediaHash, size: "full" })}
						alt=""
						draggable="false"
						class="pointer-events-none absolute inset-0 size-full object-cover"
					/>
				{/if}
				<div
					class="relative w-full bg-linear-to-t from-black/80 to-transparent p-4 pt-16"
				>
					<p class="truncate text-2xl font-semibold text-white">
						<DisplayName name={current.displayName} />{#if current.age}, {current.age}{/if}
					</p>
					{#if current.distance !== null}
						<p class="text-sm text-white/80">
							<DistanceFormatted distance={current.distance} />
						</p>
					{/if}
				</div>
				{#if dragX > 30}
					<span class="absolute top-6 left-6 rounded-xl border-2 border-primary px-3 py-1 text-xl font-bold text-primary neon-text">
						ME GUSTA
					</span>
				{:else if dragX < -30}
					<span class="absolute top-6 right-6 rounded-xl border-2 border-destructive px-3 py-1 text-xl font-bold text-destructive">
						NO
					</span>
				{/if}
			</div>

			<div class="flex items-center justify-center gap-6">
				<button
					type="button"
					aria-label="No me gusta"
					class="flex size-16 items-center justify-center rounded-full border-2 border-destructive/70 text-destructive transition active:scale-90"
					onclick={() => decide("nope")}
				>
					<XIcon weight="bold" class="size-7" />
				</button>
				<button
					type="button"
					aria-label="Después"
					class="flex size-12 flex-col items-center justify-center rounded-full bg-secondary text-secondary-foreground transition active:scale-90"
					onclick={later}
				>
					<ClockIcon weight="bold" class="size-5" />
				</button>
				<button
					type="button"
					aria-label="Me gusta"
					class="neon-glow flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground transition active:scale-90"
					onclick={() => decide("like")}
				>
					<HeartIcon weight="fill" class="size-7" />
				</button>
			</div>
			<p class="text-center text-xs text-muted-foreground">
				Deslizá a la derecha ❤ o a la izquierda ✕ · el reloj lo deja para después
			</p>
		{:else}
			<div class="m-auto flex flex-col items-center gap-3 text-center">
				{#if hasMorePages || gridState.paging.running}
					<p class="text-muted-foreground">Cargando más perfiles…</p>
				{:else}
					<p class="text-lg font-semibold">Ya elegiste a todos</p>
					<p class="text-muted-foreground">
						Volvé más tarde o cambiá de zona para ver gente nueva.
					</p>
				{/if}
				<Button variant="secondary" onclick={close}>Volver a la grilla</Button>
			</div>
		{/if}
	</div>
{/if}
