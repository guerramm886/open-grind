<script lang="ts">
	import ArrowClockwiseIcon from "phosphor-svelte/lib/ArrowClockwiseIcon";
	import HouseIcon from "phosphor-svelte/lib/HouseIcon";
	import LockSimpleIcon from "phosphor-svelte/lib/LockSimpleIcon";
	import StarIcon from "phosphor-svelte/lib/StarIcon";
	import XIcon from "phosphor-svelte/lib/XIcon";

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
	import DistanceFormatted from "$lib/components/profile/DistanceFormatted.svelte";
	import UserAvatar from "$lib/components/profile/UserAvatar.svelte";
	import ProgressiveBlur from "$lib/components/shared/ProgressiveBlur.svelte";
	import { Button } from "$lib/components/ui/button";
	import { Skeleton } from "$lib/components/ui/skeleton";
	import { swipeDecisions } from "$lib/grid/swipe-decisions.svelte";
	import { proxyMediaUrl } from "$lib/util/media";
	import { topChrome } from "$lib/util/screen-chrome.svelte";

	let posts = $state<RightNowPost[]>([]);
	let loading = $state(true);
	let error = $state(false);
	let sort = $state<RightNowSort>("DISTANCE");
	let hostingOnly = $state(false);
	let favorites = $state<Record<number, boolean>>({});

	async function load(currentSort: RightNowSort, currentHosting: boolean) {
		loading = true;
		error = false;
		try {
			posts = await getRightNowFeed({
				sort: currentSort,
				hosting: currentHosting || undefined,
			});
		} catch (err) {
			console.error(err);
			error = true;
		} finally {
			loading = false;
		}
	}

	// Reload whenever the sort or hosting filter changes.
	$effect(() => {
		void load(sort, hostingOnly);
	});

	const visible = $derived(
		posts.filter((post) => !swipeDecisions.isNope(post.profileId)),
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
			onclick={() => void load(sort, hostingOnly)}
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
			aria-pressed={hostingOnly}
			class={{
				"bg-primary text-primary-foreground hover:bg-primary/90":
					hostingOnly,
			}}
			onclick={() => (hostingOnly = !hostingOnly)}
		>
			<HouseIcon weight="fill" class="size-3.5" /> Hospedan
		</Button>
	</div>
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
						onclick={() => void load(sort, hostingOnly)}>Reintentar</button
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
									onclick={() =>
										swipeDecisions.cross(post.profileId)}
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
