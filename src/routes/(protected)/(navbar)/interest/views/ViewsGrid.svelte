<script lang="ts">
	import { untrack } from "svelte";

	import ApiErrorDisplay from "$lib/components/feedback/ApiErrorDisplay.svelte";
	import DataRefreshControl from "$lib/components/feedback/DataRefreshControl.svelte";
	import ScrollToTopButton from "$lib/components/shared/ScrollToTopButton.svelte";
	import { Button } from "$lib/components/ui/button";
	import { Skeleton } from "$lib/components/ui/skeleton";
	import { observeIntersection } from "$lib/util/observe-intersection";
	import { restoreScrollOnce } from "$lib/util/scroll-restore.svelte";
	import EmptyViewsGrid from "./EmptyViewsGrid.svelte";
	import UntrackedViewsGrid from "./UntrackedViewsGrid.svelte";
	import ViewedPreview from "./ViewedPreview.svelte";
	import ViewedProfile from "./ViewedProfile.svelte";
	import { getViewsState } from "./views-state.svelte";

	let { ourProfileId }: { ourProfileId: number } = $props();

	const views = untrack(() => {
		const state = getViewsState(ourProfileId);
		state.load();
		return state;
	});

	let container: HTMLDivElement | null = $state(null);
	let heartedOnly = $state(false);
	let onlineOnly = $state(false);

	const shownViews = $derived(
		views.views.filter((entry) => {
			const isFavorite =
				entry.type === "profile"
					? entry.profile.isFavorite
					: entry.preview.isFavorite;
			if (heartedOnly && !isFavorite) return false;
			if (onlineOnly) {
				// Previews (locked viewers) carry no online info, so they're
				// dropped when filtering by who's online.
				const onlineUntil =
					entry.type === "profile" ? entry.profile.onlineUntil : null;
				if (!onlineUntil || onlineUntil <= Date.now()) return false;
			}
			return true;
		}),
	);

	restoreScrollOnce({ container: () => container, state: views });
</script>

<main class="screen-nav-host">
	{#if !views.loading && (views.views.length > 0 || !views.error)}
		<DataRefreshControl
			{container}
			updating={views.refreshing}
			position="top"
			onrefresh={() => void views.refresh()}
		/>
	{/if}
	<div
		bind:this={container}
		data-slot="views-scroller"
		class="pull-scroller overscroll-x-auto"
		onscroll={() => (views.scrollY = container?.scrollTop ?? 0)}
	>
		<div
			data-refresh-content
			class="@container/photo-grid mx-auto min-h-overscrollable flex w-full max-w-120 flex-col gap-3 px-4 pt-header-clear-16 pb-nav-clear"
		>
			{#if views.loading}
				<div class="photo-grid">
					{#each Array(24)}
						<Skeleton class="aspect-square rounded-none" />
					{/each}
				</div>
			{:else if views.error && views.views.length === 0}
				<div class="flex flex-1">
					<ApiErrorDisplay
						error={views.error}
						onRetry={() => views.retry()}
						class="m-auto"
					/>
				</div>
			{:else if views.views.length === 0 && views.viewedMeHidden}
				<UntrackedViewsGrid
					enabling={views.enablingViewedMe}
					onEnable={() => void views.enableViewedMeTracking()}
				/>
			{:else if views.views.length === 0}
				{#if views.hasUnavailablePreviews}
					<p class="py-8 text-center text-sm text-muted-foreground">
						No hay visitas disponibles para abrir.
					</p>
				{:else}
					<EmptyViewsGrid />
				{/if}
			{:else}
				<div class="flex items-center gap-2">
					<Button
						variant="secondary"
						size="sm"
						aria-pressed={heartedOnly}
						class={{
							"bg-primary text-primary-foreground hover:bg-primary/90":
								heartedOnly,
						}}
						onclick={() => (heartedOnly = !heartedOnly)}
					>
						Favoritos ❤
					</Button>
					<Button
						variant="secondary"
						size="sm"
						aria-pressed={onlineOnly}
						class={{
							"bg-primary text-primary-foreground hover:bg-primary/90":
								onlineOnly,
						}}
						onclick={() => (onlineOnly = !onlineOnly)}
					>
						En línea 🟢
					</Button>
				</div>
				{#if shownViews.length === 0}
					<p class="py-8 text-center text-sm text-muted-foreground">
						Nadie coincide con el filtro.
					</p>
				{:else}
					<div class="photo-grid">
						{#each shownViews as entry (entry.key)}
							{#if entry.type === "profile"}
								<ViewedProfile view={entry.profile} />
							{:else}
								<ViewedPreview preview={entry.preview} />
							{/if}
						{/each}
					</div>
				{/if}
				{#if views.hasMore}
					<div
						class="h-0"
						use:observeIntersection={{
							handle: () => views.loadMore(),
							rootMargin: "400px",
						}}
					></div>
				{/if}
			{/if}
		</div>
	</div>
	<ScrollToTopButton {container} class="bottom-nav-clear" />
</main>
