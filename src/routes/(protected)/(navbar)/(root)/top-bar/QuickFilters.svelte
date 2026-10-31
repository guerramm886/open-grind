<script lang="ts">
	import SlidersHorizontalIcon from "phosphor-svelte/lib/SlidersHorizontalIcon";

	import { genderFilterFlag } from "$lib/api/feature-flags-state.svelte";
	import QuickFilterButton from "$lib/components/filters/QuickFilterButton.svelte";
	import { gridState } from "$lib/grid/grid-state.svelte";
	import { defaultFilters } from "$lib/model/browse/grid/filters";
	import AgeQuickFilter from "./AgeQuickFilter.svelte";
	import PositionQuickFilter from "./PositionQuickFilter.svelte";
	import { sentFilterKeysWithoutQuickFilter } from "./quick-filters";

	let {
		openFilters = $bindable(),
	}: { openFilters: { all: boolean; age: boolean; position: boolean } } =
		$props();

	const filters = $derived(gridState.filters.value ?? defaultFilters);
	const { ageEnabled, positionEnabled } = $derived(filters);
	const sheetOnlyFiltersSent = $derived(
		sentFilterKeysWithoutQuickFilter({
			filters,
			genderFilterFlag: genderFilterFlag(),
		}).length > 0,
	);

	// Active toggles sort to the left so they're closer to hand to turn off.
	const toggles = $derived(
		[
			{
				label: "Online",
				active: filters.isOnline,
				toggle: () =>
					gridState.filters.set({ isOnline: !filters.isOnline }),
			},
			{
				label: "Right now",
				active: filters.isRightNow,
				toggle: () =>
					gridState.filters.set({ isRightNow: !filters.isRightNow }),
			},
			{
				label: "Fresh",
				active: filters.isFresh,
				toggle: () =>
					gridState.filters.set({ isFresh: !filters.isFresh }),
			},
			{
				label: "Populares",
				active: gridState.popularOnly,
				toggle: () => gridState.togglePopularOnly(),
			},
			{
				label: "Sin distancia",
				active: gridState.hiddenDistanceOnly,
				toggle: () => gridState.toggleHiddenDistanceOnly(),
			},
			{
				label: "Cruzados",
				active: gridState.crossedOnly,
				toggle: () => gridState.toggleCrossedOnly(),
			},
		].sort((a, b) => Number(b.active) - Number(a.active)),
	);
</script>

<QuickFilterButton
	active={sheetOnlyFiltersSent}
	label="All filters"
	onclick={() => (openFilters.all = true)}
>
	<SlidersHorizontalIcon />
</QuickFilterButton>
<QuickFilterButton active={ageEnabled} onclick={() => (openFilters.age = true)}>
	Age
</QuickFilterButton>
<QuickFilterButton
	active={positionEnabled}
	onclick={() => (openFilters.position = true)}
>
	Position
</QuickFilterButton>
{#each toggles as toggle (toggle.label)}
	<QuickFilterButton active={toggle.active} onclick={toggle.toggle}>
		{toggle.label}
	</QuickFilterButton>
{/each}

<AgeQuickFilter bind:open={openFilters.age} />
<PositionQuickFilter bind:open={openFilters.position} />
