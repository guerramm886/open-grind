<script lang="ts">
	import ArrowLeftIcon from "phosphor-svelte/lib/ArrowLeftIcon";
	import CrosshairIcon from "phosphor-svelte/lib/CrosshairIcon";
	import { untrack } from "svelte";

	import { goto } from "$app/navigation";
	import {
		hydratePreferences,
		preferencesSnapshot,
	} from "$lib/app-data/preferences.svelte";
	import UserSilhouette from "$lib/components/profile/UserSilhouette.svelte";
	import ProgressiveBlur from "$lib/components/shared/ProgressiveBlur.svelte";
	import { type RenderedGridProfile } from "$lib/grid/grid";
	import { gridState } from "$lib/grid/grid-state.svelte";
	import {
		dotSizeFor,
		layoutRadar,
		radarRings,
	} from "$lib/grid/radar-layout";
	import { getNow } from "$lib/util/now";
	import { profileMediaUrl } from "$lib/util/media";
	import { topChrome } from "$lib/util/screen-chrome.svelte";
	import { formatDistance } from "$lib/util/units";

	const RANGE_KEY = "radar-range-v1";
	const RANGES: { label: string; metres: number | null }[] = [
		{ label: "1 km", metres: 1_000 },
		{ label: "3 km", metres: 3_000 },
		{ label: "10 km", metres: 10_000 },
		{ label: "Todos", metres: null },
	];
	const MAX_LAZY_RESOLVE = 120;

	const preferencesHydrated = hydratePreferences();
	const geohash = $derived(preferencesSnapshot().geohash);
	const units = $derived(preferencesSnapshot().units);

	function loadRange(): number | null {
		try {
			const raw = localStorage.getItem(RANGE_KEY);
			if (raw === null) return 3_000;
			const value = Number(raw);
			return value > 0 ? value : null;
		} catch {
			return 3_000;
		}
	}

	let range = $state<number | null>(loadRange());
	let width = $state(0);

	function chooseRange(metres: number | null) {
		range = metres;
		try {
			localStorage.setItem(RANGE_KEY, String(metres ?? 0));
		} catch {
			/* only a convenience */
		}
	}

	$effect.pre(() => {
		if (geohash !== null) gridState.load(geohash);
	});
	$effect(() => gridState.attachView());

	// Profiles the grid hasn't filled in yet carry no distance: fetch them.
	$effect(() => {
		const lazy = gridState.profiles
			.filter((profile) => profile.type === "lazy")
			.slice(0, MAX_LAZY_RESOLVE)
			.map((profile) => profile.id);
		untrack(() => {
			for (const id of lazy)
				gridState.resolveProfile(id).catch((error: unknown) => {
					console.error(error);
				});
		});
	});

	const rendered = $derived(
		gridState.profiles.filter(
			(profile): profile is RenderedGridProfile =>
				profile.type === "rendered",
		),
	);
	const withDistance = $derived(
		rendered.filter(
			(profile): profile is RenderedGridProfile & { distance: number } =>
				profile.distance !== null,
		),
	);
	const hiddenDistance = $derived(rendered.length - withDistance.length);
	const farthest = $derived(
		withDistance.reduce((max, profile) => Math.max(max, profile.distance), 0),
	);
	const maxDistance = $derived(Math.max(range ?? farthest, 200));
	const shown = $derived(
		withDistance.filter((profile) => profile.distance <= maxDistance),
	);
	const outside = $derived(withDistance.length - shown.length);
	const byId = $derived(new Map(shown.map((profile) => [profile.id, profile])));

	const size = $derived(Math.max(Math.min(width, 640), 240));
	// Smaller photos when many people are close, so they overlap less.
	const DOT = $derived(
		dotSizeFor({ count: shown.length, outerRadius: size / 2 - 24 }),
	);
	const outerRadius = $derived(size / 2 - DOT / 2 - 2);
	const innerRadius = $derived(Math.max(DOT * 0.85, 24));
	const rings = $derived(
		radarRings({ maxDistance, innerRadius, outerRadius }),
	);
	const dots = $derived(
		layoutRadar({
			people: shown.map((profile) => ({
				id: profile.id,
				distance: profile.distance,
			})),
			maxDistance,
			innerRadius,
			outerRadius,
			dotSize: DOT,
		}),
	);
	const nearest = $derived(
		[...shown].sort((a, b) => a.distance - b.distance).slice(0, 5),
	);
	const canLoadMore = $derived(
		gridState.nextPage !== 0 && gridState.nextPage !== null,
	);

	function open(id: number) {
		void goto(`/profile/${id}`, { state: { profileOrigin: "browse" } });
	}
</script>

<svelte:head>
	<title>Radar</title>
</svelte:head>

<ProgressiveBlur
	direction="topToBottom"
	tag="nav"
	aria-label="Radar"
	data-fixed-header
	class="fixed top-0 left-0 z-10 w-full px-4 pt-fixed-header pb-2"
	bgClass="bg-linear-to-b from-background to-transparent"
	contentClass="flex flex-col gap-2 w-full max-w-160 mx-auto"
	{@attach topChrome}
>
	<div class="flex h-10 items-center gap-2">
		<a
			href="/"
			aria-label="Volver"
			class="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-input/30"
		>
			<ArrowLeftIcon class="size-5" />
		</a>
		<CrosshairIcon weight="bold" class="size-5 text-accent" />
		<h1 class="text-base font-semibold">Radar de cercanía</h1>
	</div>
	<div class="flex gap-1.5" role="group" aria-label="Distancia máxima">
		{#each RANGES as option (option.label)}
			<button
				type="button"
				aria-pressed={range === option.metres}
				class={[
					"rounded-full px-3 py-1.5 text-sm",
					range === option.metres
						? "bg-primary text-primary-foreground"
						: "bg-secondary",
				]}
				onclick={() => chooseRange(option.metres)}
			>
				{option.label}
			</button>
		{/each}
	</div>
</ProgressiveBlur>

<main class="screen-nav-host">
	<div class="pull-scroller">
		<div
			class="mx-auto mt-24 flex min-h-overscrollable w-full max-w-160 flex-col gap-4 px-4 pt-header-clear-16 pb-nav-clear"
		>
			{#await preferencesHydrated then}
				{#if geohash === null}
					<p class="py-8 text-center text-sm text-muted-foreground">
						Primero elegí tu ubicación en la grilla.
					</p>
				{:else}
					<div bind:clientWidth={width} class="w-full">
						<div
							class="relative mx-auto overflow-hidden rounded-full border border-border bg-card"
							style:width="{size}px"
							style:height="{size}px"
						>
							{#each rings as ring (ring.distance)}
								<div
									class="pointer-events-none absolute rounded-full border border-dashed border-muted-foreground/30"
									style:width="{ring.radius * 2}px"
									style:height="{ring.radius * 2}px"
									style:left="{size / 2 - ring.radius}px"
									style:top="{size / 2 - ring.radius}px"
								></div>
								<span
									class="pointer-events-none absolute -translate-x-1/2 rounded bg-card/80 px-1 text-[10px] text-muted-foreground"
									style:left="{size / 2}px"
									style:top="{size / 2 - ring.radius - 7}px"
								>
									{formatDistance(ring.distance, units)}
								</span>
							{/each}

							<div
								class="absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground shadow"
								style:left="{size / 2}px"
								style:top="{size / 2}px"
							>
								Vos
							</div>

							{#each dots as dot (dot.id)}
								{@const profile = byId.get(dot.id)}
								{#if profile}
									{@const hash = profile.profilePhotosHashes?.[0] ?? null}
									{@const online = (profile.onlineUntil ?? 0) > getNow()}
									<button
										type="button"
										class="absolute -translate-x-1/2 -translate-y-1/2 overflow-visible rounded-lg shadow-md ring-2 ring-background active:scale-95"
										style:left="{size / 2 + dot.x}px"
										style:top="{size / 2 + dot.y}px"
										style:width="{DOT}px"
										style:height="{DOT}px"
										aria-label={`${profile.displayName ?? "Sin nombre"}, a ${formatDistance(profile.distance, units)}`}
										onclick={() => open(profile.id)}
									>
										{#if hash}
											<img
												src={profileMediaUrl({ mediaHash: hash, size: "thumb" })}
												alt=""
												loading="lazy"
												class="size-full rounded-lg bg-neutral-800 object-cover"
											/>
										{:else}
											<span
												class="flex size-full items-center justify-center rounded-lg bg-black"
											>
												<UserSilhouette class="size-3/5" />
											</span>
										{/if}
										{#if online}
											<span
												class="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-card bg-green-500"
											></span>
										{/if}
									</button>
								{/if}
							{/each}
						</div>
					</div>

					<p class="text-center text-xs text-muted-foreground">
						Cada anillo es la distancia que muestra Grindr. La dirección
						no es real: Grindr no la da, así que cada persona queda en un
						lugar fijo de su anillo.
					</p>

					<p class="text-center text-xs text-muted-foreground">
						{shown.length} en el radar{outside > 0
							? ` · ${outside} más lejos`
							: ""}{hiddenDistance > 0
							? ` · ${hiddenDistance} no muestran distancia`
							: ""}
						{#if gridState.loading || gridState.paging.running}
							· cargando…
						{/if}
					</p>

					{#if canLoadMore}
						<button
							type="button"
							class="self-center rounded-full bg-secondary px-4 py-2 text-sm"
							disabled={gridState.paging.running}
							onclick={() => void gridState.paging.run()}
						>
							Cargar más perfiles
						</button>
					{/if}

					{#if nearest.length > 0}
						<div class="rounded-xl border p-3">
							<p class="text-sm font-semibold">Los más cerca</p>
							<ul class="mt-2 flex flex-col gap-2">
								{#each nearest as profile (profile.id)}
									{@const hash = profile.profilePhotosHashes?.[0] ?? null}
									<li>
										<button
											type="button"
											class="flex w-full items-center gap-3 text-left"
											onclick={() => open(profile.id)}
										>
											{#if hash}
												<img
													src={profileMediaUrl({
														mediaHash: hash,
														size: "thumb",
													})}
													alt=""
													loading="lazy"
													class="size-10 rounded-lg bg-neutral-800 object-cover"
												/>
											{:else}
												<span
													class="flex size-10 items-center justify-center rounded-lg bg-black"
												>
													<UserSilhouette class="size-3/5" />
												</span>
											{/if}
											<span class="min-w-0 flex-1 truncate text-sm">
												{profile.displayName ?? "Sin nombre"}
											</span>
											<span class="text-sm text-muted-foreground">
												{formatDistance(profile.distance, units)}
											</span>
										</button>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				{/if}
			{/await}
		</div>
	</div>
</main>
