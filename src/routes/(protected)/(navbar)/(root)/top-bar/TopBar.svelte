<script lang="ts">
	import MagnifyingGlassIcon from "phosphor-svelte/lib/MagnifyingGlassIcon";

	import CommandCenterTrigger from "$lib/components/command-center/CommandCenterTrigger.svelte";
	import ProgressiveBlur from "$lib/components/shared/ProgressiveBlur.svelte";
	import { gridState } from "$lib/grid/grid-state.svelte";
	import { topChrome } from "$lib/util/screen-chrome.svelte";
	import GridFilters from "../GridFilters.svelte";
	import LocationChange from "../LocationChange.svelte";
	import ChooseDeckButton from "./ChooseDeckButton.svelte";
	import QuickFilters from "./QuickFilters.svelte";

	let openFilters = $state({ all: false, age: false, position: false });
	let searchOpen = $state(false);
</script>

<ProgressiveBlur
	data-fixed-header
	class="fixed top-0 left-0 z-10 w-full"
	bgClass="bg-linear-to-b from-background to-transparent"
	contentClass="flex flex-col pt-fixed-header"
	direction="topToBottom"
	{@attach topChrome}
>
	<div class="flex items-start gap-0.5 p-4 pt-0">
		<ChooseDeckButton />
		<button
			type="button"
			aria-label="Buscar perfiles"
			aria-expanded={searchOpen}
			class="rounded-full bg-secondary p-2.5"
			onclick={() => (searchOpen = !searchOpen)}
			><MagnifyingGlassIcon class="size-5" /></button
		>
		<div
			data-scroll-intent="x"
			class="scrollbar-thin flex min-w-0 flex-1 gap-0.5 overflow-x-auto"
		>
			<LocationChange />
			<QuickFilters bind:openFilters />
			<CommandCenterTrigger />
		</div>
	</div>
	{#if searchOpen}
		<div class="px-4 pb-2">
			<input
				type="search"
				aria-label="Buscar por nombre o descripción"
				placeholder="Buscar por nombre o descripción"
				bind:value={gridState.searchText}
				class="w-full rounded-xl bg-card px-4 py-3 text-foreground"
			/>
			<p class="text-xs text-muted-foreground">
				{gridState.searchingDescriptions
					? "Revisando descripciones…"
					: gridState.descriptionSearchErrors
						? "No se pudieron revisar todas las descripciones."
						: "Busca entre los perfiles cargados; revisa hasta 200 descripciones."}
			</p>
		</div>
	{/if}
</ProgressiveBlur>
<GridFilters bind:open={openFilters.all} />
