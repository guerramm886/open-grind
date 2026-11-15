<script lang="ts">
	import MagnifyingGlassIcon from "phosphor-svelte/lib/MagnifyingGlassIcon";

	import CommandCenterTrigger from "$lib/components/command-center/CommandCenterTrigger.svelte";
	import ProgressiveBlur from "$lib/components/shared/ProgressiveBlur.svelte";
	import { gridState } from "$lib/grid/grid-state.svelte";
	import { gemini } from "$lib/search/gemini-search.svelte";
	import { visionQueue } from "$lib/search/vision-queue.svelte";
	import { topChrome } from "$lib/util/screen-chrome.svelte";
	import GridFilters from "../GridFilters.svelte";
	import LocationChange from "../LocationChange.svelte";
	import PhotoSearchQueue from "./PhotoSearchQueue.svelte";
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
		<button
			type="button"
			aria-label="Buscar perfiles"
			aria-expanded={searchOpen}
			class="relative rounded-full bg-secondary p-2.5"
			onclick={() => (searchOpen = !searchOpen)}
			><MagnifyingGlassIcon class="size-5" />{#if visionQueue.pendingCount > 0}<span
					class="absolute top-0.5 right-0.5 size-3 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-accent"
				></span>{/if}</button
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
		<div class="flex flex-col gap-2 px-4 pb-2">
			<input
				type="search"
				aria-label="Buscar por nombre o descripción"
				placeholder="Buscar por nombre o descripción"
				bind:value={gridState.searchText}
				class="w-full rounded-xl bg-card px-4 py-3 text-foreground"
			/>
			{#if gemini.configured}
				<PhotoSearchQueue />
			{:else}
				<a href="/settings/app" class="self-start text-2xs text-accent underline">
					Activá la búsqueda en fotos (Gemini) en Configuración
				</a>
			{/if}
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
