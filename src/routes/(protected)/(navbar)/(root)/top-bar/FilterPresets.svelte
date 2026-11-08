<script lang="ts">
	import TrashIcon from "phosphor-svelte/lib/TrashIcon";

	import QuickFilterButton from "$lib/components/filters/QuickFilterButton.svelte";
	import { filterPresets } from "$lib/grid/filter-presets.svelte";
	import { gridState } from "$lib/grid/grid-state.svelte";
	import { defaultFilters } from "$lib/model/browse/grid/filters";

	let open = $state(false);
	let name = $state("");

	const current = $derived(gridState.filters.value ?? defaultFilters);

	function saveCurrent() {
		filterPresets.save(name, current);
		name = "";
	}
</script>

<QuickFilterButton active={open} onclick={() => (open = !open)}>
	Presets ⭐
</QuickFilterButton>

{#if open}
	<!-- Fixed overlay so the panel isn't clipped by the filter row's scroll. -->
	<button
		type="button"
		aria-label="Cerrar presets"
		class="fixed inset-0 z-40 cursor-default"
		onclick={() => (open = false)}
	></button>
	<div
		class="fixed top-28 left-1/2 z-50 w-72 max-w-[90vw] -translate-x-1/2 rounded-2xl bg-popover p-3 shadow-lg ring-1 ring-border"
		role="dialog"
		aria-label="Presets de filtros"
	>
		<p class="mb-2 text-sm font-semibold">Presets de filtros</p>
		<div class="flex gap-1">
			<input
				bind:value={name}
				placeholder="Guardar filtros actuales como…"
				class="min-w-0 flex-1 rounded-lg bg-secondary px-2 py-1.5 text-sm"
			/>
			<button
				type="button"
				class="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground"
				onclick={saveCurrent}
			>
				Guardar
			</button>
		</div>
		<div class="mt-2 flex max-h-60 flex-col gap-1 overflow-y-auto">
			{#each filterPresets.presets as preset (preset.id)}
				<div class="flex items-center gap-1">
					<button
						type="button"
						class="min-w-0 flex-1 truncate rounded-lg bg-secondary px-2 py-1.5 text-start text-sm"
						onclick={() => {
							gridState.filters.set(preset.filters);
							open = false;
						}}
					>
						{preset.name}
					</button>
					<button
						type="button"
						aria-label="Borrar preset"
						class="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-input/40"
						onclick={() => filterPresets.remove(preset.id)}
					>
						<TrashIcon class="size-4" />
					</button>
				</div>
			{/each}
			{#if filterPresets.presets.length === 0}
				<p class="py-2 text-center text-xs text-muted-foreground">
					Configurá filtros y guardalos con un nombre.
				</p>
			{/if}
		</div>
	</div>
{/if}
