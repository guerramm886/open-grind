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

	// Only viewers the user gave a heart to; hidden/anonymous previews can't be
	// matched to a decision, so they drop out while this is on.
	const shownViews = $derived(
		heartedOnly
			? views.views.filter(
					(entry) => entry.type === "profile" && entry.profile.isFavorite,
				)
			: views.views,
	);

	restoreScrollOnce({ container: () => container, state: views });
</script>

<div class="screen-nav-host">
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
				<EmptyViewsGrid />
			{:else}
				<div class="flex items-center justify-between gap-2">
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
						Solo ❤
					</Button>
				</div>
				{#if shownViews.length === 0}
					<p class="py-8 text-center text-sm text-muted-foreground">
						Todavía no te vio nadie a quien le hayas dado ❤.
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
				{#if !heartedOnly && views.hasMore}
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
</div>
