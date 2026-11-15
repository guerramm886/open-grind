<script lang="ts">
	import ArrowClockwiseIcon from "phosphor-svelte/lib/ArrowClockwiseIcon";
	import HouseIcon from "phosphor-svelte/lib/HouseIcon";
	import LockSimpleIcon from "phosphor-svelte/lib/LockSimpleIcon";
	import StarIcon from "phosphor-svelte/lib/StarIcon";
	import XIcon from "phosphor-svelte/lib/XIcon";
	import { toast } from "svelte-sonner";

	import { showErrorToast } from "$lib/api/error-toast";
	import {
		getRightNowFeed,
		type RightNowPost,
		type RightNowSort,
	} from "$lib/api/right-now/feed";
	import {
		addFavoriteUser,
		removeFavoriteUser,
	} from "$lib/api/users/favorites";
	import { getProfile } from "$lib/api/users/profiles";
	import DistanceFormatted from "$lib/components/profile/DistanceFormatted.svelte";
	import UserAvatar from "$lib/components/profile/UserAvatar.svelte";
	import ProgressiveBlur from "$lib/components/shared/ProgressiveBlur.svelte";
	import { Button } from "$lib/components/ui/button";
	import { Skeleton } from "$lib/components/ui/skeleton";
	import { swipeDecisions } from "$lib/grid/swipe-decisions.svelte";
	import { SexualPosition } from "$lib/model/users/profiles";
	import { proxyMediaUrl } from "$lib/util/media";
	import { topChrome } from "$lib/util/screen-chrome.svelte";

	let posts = $state<RightNowPost[]>([]);
	let loading = $state(true);
	let error = $state(false);
	let favorites = $state<Record<number, boolean>>({});

	// Filters are remembered between visits.
	const FILTERS_STORAGE = "right-now-filters-v1";
	type Hosting = "any" | "yes" | "no";
	type Filters = {
		sort: RightNowSort;
		hosting: Hosting;
		positions: number[];
		ageMin: number | null;
		ageMax: number | null;
		favoritesOnly: boolean;
		withPhotoOnly: boolean;
	};
	const DEFAULT_FILTERS: Filters = {
		sort: "DISTANCE",
		hosting: "any",
		positions: [],
		ageMin: null,
		ageMax: null,
		favoritesOnly: false,
		withPhotoOnly: false,
	};
	function loadFilters(): Filters {
		try {
			const saved: unknown = JSON.parse(
				localStorage.getItem(FILTERS_STORAGE) ?? "{}",
			);
			return { ...DEFAULT_FILTERS, ...(saved as Partial<Filters>) };
		} catch {
			return { ...DEFAULT_FILTERS };
		}
	}
	const saved = loadFilters();
	let sort = $state<RightNowSort>(saved.sort);
	let hosting = $state<Hosting>(saved.hosting);
	let positions = $state<number[]>(saved.positions);
	let ageMin = $state<number | null>(saved.ageMin);
	let ageMax = $state<number | null>(saved.ageMax);
	let favoritesOnly = $state(saved.favoritesOnly);
	let withPhotoOnly = $state(saved.withPhotoOnly);
	let openPanel = $state<"position" | "age" | null>(null);

	const POSITION_CHOICES = [
		{ id: SexualPosition.Top, label: "Activo" },
		{ id: SexualPosition.VersTop, label: "Vers activo" },
		{ id: SexualPosition.Versatile, label: "Versátil" },
		{ id: SexualPosition.VersBottom, label: "Vers pasivo" },
		{ id: SexualPosition.Bottom, label: "Pasivo" },
		{ id: SexualPosition.Side, label: "Side" },
		{ id: -1, label: "Sin especificar" },
	];

	function togglePosition(id: number) {
		positions = positions.includes(id)
			? positions.filter((value) => value !== id)
			: [...positions, id];
	}

	function parseAge(value: string): number | null {
		const age = Math.round(Number(value));
		return Number.isFinite(age) && age >= 18 && age <= 99 ? age : null;
	}

	const activeFilters = $derived(
		(hosting !== "any" ? 1 : 0) +
			(positions.length > 0 ? 1 : 0) +
			(ageMin !== null || ageMax !== null ? 1 : 0) +
			(favoritesOnly ? 1 : 0) +
			(withPhotoOnly ? 1 : 0),
	);

	function clearFilters() {
		hosting = "any";
		positions = [];
		ageMin = null;
		ageMax = null;
		favoritesOnly = false;
		withPhotoOnly = false;
		openPanel = null;
	}

	// Only the latest request may fill the list (filters can change mid-load).
	let loadToken = 0;
	async function load() {
		const token = ++loadToken;
		loading = true;
		error = false;
		try {
			const result = await getRightNowFeed({
				sort,
				hosting: hosting === "any" ? undefined : hosting === "yes",
				positions,
				ageMin: ageMin ?? undefined,
				ageMax: ageMax ?? undefined,
			});
			if (token !== loadToken) return;
			posts = result;
		} catch (err) {
			if (token !== loadToken) return;
			console.error(err);
			error = true;
		} finally {
			if (token === loadToken) loading = false;
		}
	}

	// Reload whenever a filter Grindr applies changes, and remember them all.
	$effect(() => {
		const filters: Filters = {
			sort,
			hosting,
			positions,
			ageMin,
			ageMax,
			favoritesOnly,
			withPhotoOnly,
		};
		try {
			localStorage.setItem(FILTERS_STORAGE, JSON.stringify(filters));
		} catch {
			/* storage unavailable */
		}
	});
	$effect(() => {
		// Touch every server-side filter so the effect re-runs on each.
		void [sort, hosting, positions, ageMin, ageMax];
		void load();
	});

	const visible = $derived(
		posts.filter(
			(post) =>
				!swipeDecisions.isNope(post.profileId) &&
				(!favoritesOnly || isFavorite(post)) &&
				(!withPhotoOnly || photoOf(post) !== null),
		),
	);

	function photoOf(post: RightNowPost): string | null {
		const url = post.media?.[0]?.data?.thumbnailUrl;
		return url ? proxyMediaUrl(url) : null;
	}

	function isFavorite(post: RightNowPost): boolean {
		return favorites[post.profileId] ?? post.isFavorite ?? false;
	}

	async function toggleFavorite(post: RightNowPost) {
		const next = !isFavorite(post);
		favorites = { ...favorites, [post.profileId]: next };
		try {
			if (next) await addFavoriteUser({ profileId: post.profileId });
			else await removeFavoriteUser({ profileId: post.profileId });
		} catch (err) {
			favorites = { ...favorites, [post.profileId]: !next };
			showErrorToast({ label: "No se pudo cambiar el favorito", error: err });
		}
	}
	// The feed doesn't say who is already a favorite, so ask each profile once
	// (a few at a time) and light the star for the ones that are.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- once-per-session guard, not reactive
	const favoriteChecked = new Set<number>();
	$effect(() => {
		// All loaded posts, not just the visible ones: the favorites filter
		// needs to know about the ones it is hiding.
		const pending = posts
			.map((post) => post.profileId)
			.filter((id) => !favoriteChecked.has(id));
		if (pending.length === 0) return;
		for (const id of pending) favoriteChecked.add(id);
		const queue = [...pending];
		const worker = async () => {
			for (;;) {
				const id = queue.shift();
				if (id === undefined) return;
				try {
					const profile = await getProfile(id);
					// Don't override a star the user just tapped.
					if (profile.isFavorite && favorites[id] === undefined)
						favorites = { ...favorites, [id]: true };
				} catch {
					/* leave the star off */
				}
			}
		};
		for (let i = 0; i < 3; i += 1) void worker();
	});

	const LIT = "bg-primary text-primary-foreground hover:bg-primary/90";

	function cross(post: RightNowPost) {
		swipeDecisions.cross(post.profileId);
		toast(`Cruzaste a ${post.displayName || "este perfil"}`, {
			action: {
				label: "Deshacer",
				onClick: () => swipeDecisions.uncross(post.profileId),
			},
		});
	}
</script>

<ProgressiveBlur
	direction="topToBottom"
	tag="nav"
	aria-label="Right Now"
	data-fixed-header
	class="fixed top-0 left-0 z-10 w-full px-4 pt-fixed-header pb-2"
	bgClass="bg-linear-to-b from-background to-transparent"
	contentClass="flex flex-col gap-2 w-full max-w-120 mx-auto"
	{@attach topChrome}
>
	<div class="flex h-10 items-center gap-2">
		<h1 class="text-base font-semibold">Right Now 🔥</h1>
		{#if loading}
			<span
				class="size-4 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-accent"
			></span>
		{/if}
		<button
			type="button"
			aria-label="Refrescar"
			class="ms-auto flex size-8 items-center justify-center rounded-full hover:bg-input/30"
			onclick={() => void load()}
		>
			<ArrowClockwiseIcon class="size-4" />
		</button>
	</div>
	<div class="flex flex-wrap items-center gap-2">
		<div class="inline-flex overflow-hidden rounded-full border">
			<button
				type="button"
				class={[
					"px-3 py-1 text-xs font-medium transition-colors",
					{
						"bg-primary text-primary-foreground": sort === "DISTANCE",
						"text-muted-foreground": sort !== "DISTANCE",
					},
				]}
				onclick={() => (sort = "DISTANCE")}
			>
				Cercanos 📍
			</button>
			<button
				type="button"
				class={[
					"px-3 py-1 text-xs font-medium transition-colors",
					{
						"bg-primary text-primary-foreground": sort === "NEWEST",
						"text-muted-foreground": sort !== "NEWEST",
					},
				]}
				onclick={() => (sort = "NEWEST")}
			>
				Recientes 🕒
			</button>
		</div>
		<Button
			variant="secondary"
			size="sm"
			aria-label="Hospedaje: {hosting === 'yes'
				? 'solo los que hospedan'
				: hosting === 'no'
					? 'solo los que no hospedan'
					: 'todos'}"
			class={hosting !== "any" ? LIT : ""}
			onclick={() =>
				(hosting =
					hosting === "any" ? "yes" : hosting === "yes" ? "no" : "any")}
		>
			<HouseIcon weight="fill" class="size-3.5" />
			{hosting === "no" ? "No hospedan" : "Hospedan"}
		</Button>
		<Button
			variant="secondary"
			size="sm"
			aria-expanded={openPanel === "position"}
			class={positions.length > 0 ? LIT : ""}
			onclick={() =>
				(openPanel = openPanel === "position" ? null : "position")}
		>
			Posición{positions.length > 0 ? ` (${positions.length})` : ""}
		</Button>
		<Button
			variant="secondary"
			size="sm"
			aria-expanded={openPanel === "age"}
			class={ageMin !== null || ageMax !== null ? LIT : ""}
			onclick={() => (openPanel = openPanel === "age" ? null : "age")}
		>
			{ageMin !== null || ageMax !== null
				? `${ageMin ?? 18}–${ageMax ?? 99} años`
				: "Edad"}
		</Button>
		<Button
			variant="secondary"
			size="sm"
			aria-pressed={favoritesOnly}
			class={favoritesOnly ? LIT : ""}
			onclick={() => (favoritesOnly = !favoritesOnly)}
		>
			<StarIcon weight="fill" class="size-3.5" /> Favoritos
		</Button>
		<Button
			variant="secondary"
			size="sm"
			aria-pressed={withPhotoOnly}
			class={withPhotoOnly ? LIT : ""}
			onclick={() => (withPhotoOnly = !withPhotoOnly)}
		>
			Con foto
		</Button>
		{#if activeFilters > 0}
			<button
				type="button"
				class="px-1 text-xs text-muted-foreground underline"
				onclick={clearFilters}
			>
				Limpiar
			</button>
		{/if}
	</div>
	{#if openPanel === "position"}
		<div class="flex flex-wrap gap-1.5 rounded-xl bg-card p-2">
			{#each POSITION_CHOICES as choice (choice.id)}
				{@const on = positions.includes(choice.id)}
				<button
					type="button"
					aria-pressed={on}
					class={[
						"rounded-full border px-2.5 py-1 text-xs font-medium",
						on
							? "border-primary bg-primary text-primary-foreground"
							: "text-muted-foreground",
					]}
					onclick={() => togglePosition(choice.id)}
				>
					{choice.label}
				</button>
			{/each}
		</div>
	{:else if openPanel === "age"}
		<div class="flex items-center gap-2 rounded-xl bg-card p-2 text-xs">
			<label class="flex items-center gap-1">
				Desde
				<input
					type="number"
					inputmode="numeric"
					min="18"
					max="99"
					placeholder="18"
					value={ageMin ?? ""}
					class="w-14 rounded-lg bg-input/30 px-2 py-1 text-foreground"
					onchange={(event) =>
						(ageMin = parseAge(event.currentTarget.value))}
				/>
			</label>
			<label class="flex items-center gap-1">
				hasta
				<input
					type="number"
					inputmode="numeric"
					min="18"
					max="99"
					placeholder="99"
					value={ageMax ?? ""}
					class="w-14 rounded-lg bg-input/30 px-2 py-1 text-foreground"
					onchange={(event) =>
						(ageMax = parseAge(event.currentTarget.value))}
				/>
			</label>
			<span class="text-muted-foreground">años</span>
		</div>
	{/if}
</ProgressiveBlur>

<main class="screen-nav-host">
	<div class="pull-scroller">
		<div
			class="@container/photo-grid mx-auto min-h-overscrollable mt-14 w-full max-w-120 px-2 pt-header-clear-16 pb-nav-clear"
		>
			{#if loading && posts.length === 0}
				<div class="grid grid-cols-2 gap-2">
					{#each Array(8)}
						<Skeleton class="aspect-square rounded-lg" />
					{/each}
				</div>
			{:else if error && posts.length === 0}
				<p class="py-8 text-center text-sm text-muted-foreground">
					No se pudo cargar Right Now. <button
						class="underline"
						onclick={() => void load()}>Reintentar</button
					>
				</p>
			{:else if visible.length === 0}
				<p class="py-8 text-center text-sm text-muted-foreground">
					No hay nadie en Right Now ahora con ese filtro.
				</p>
			{:else}
				<div class="grid grid-cols-2 gap-2">
					{#each visible as post (post.profileId)}
						{@const photo = photoOf(post)}
						<div
							class="relative aspect-square overflow-hidden rounded-lg bg-stone-700"
						>
							{#if photo}
								<img
									src={photo}
									alt=""
									class="size-full object-cover"
								/>
							{:else}
								<UserAvatar
									mediaHash={post.mediaHash ?? null}
									class="size-full"
									size="xl"
								/>
							{/if}

							<!-- Tap the tile to open the profile. -->
							<a
								href="/profile/{post.profileId}"
								aria-label={post.displayName ?? "Perfil"}
								class="absolute inset-0"
							></a>

							{#if post.locked}
								<div
									class="absolute top-1.5 left-1.5 z-1 flex size-6 items-center justify-center rounded-full bg-black/70 text-white"
									title="Bloqueado por Grindr"
								>
									<LockSimpleIcon weight="fill" class="size-3.5" />
								</div>
							{/if}

							<div
								class="pointer-events-none absolute right-1.5 bottom-1.5 left-1.5 z-1 flex flex-col gap-0.5"
							>
								{#if post.text}
									<p
										class="line-clamp-2 rounded bg-black/60 px-1.5 py-0.5 text-2xs text-white"
									>
										{post.text}
									</p>
								{/if}
								<div class="flex items-center gap-1">
									<span
										class="truncate text-xs font-semibold text-white drop-shadow"
									>
										{post.displayName ?? ""}
									</span>
									{#if typeof post.distance === "number"}
										<span
											class="ms-auto rounded bg-black/60 px-1 text-2xs text-white"
										>
											<DistanceFormatted
												distance={post.distance}
											/>
										</span>
									{/if}
								</div>
							</div>

							<div
								class="absolute top-1.5 right-1.5 z-1 flex gap-1"
							>
								<button
									type="button"
									aria-label={isFavorite(post)
										? "Quitar de favoritos"
										: "Agregar a favoritos"}
									class="flex size-7 items-center justify-center rounded-full bg-black/60 transition active:scale-90"
									onclick={() => void toggleFavorite(post)}
								>
									<StarIcon
										weight={isFavorite(post) ? "fill" : "bold"}
										class={[
											"size-4",
											isFavorite(post)
												? "text-yellow-400"
												: "text-white",
										]}
									/>
								</button>
								<button
									type="button"
									aria-label="Cruzar"
									class="flex size-7 items-center justify-center rounded-full bg-black/60 text-white transition active:scale-90"
									onclick={() => cross(post)}
								>
									<XIcon weight="bold" class="size-4" />
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</main>
