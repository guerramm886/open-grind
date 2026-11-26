<script lang="ts">
	import { showErrorToast } from "$lib/api/error-toast";
	import {
		preferencesSnapshot,
		setPreferences,
	} from "$lib/app-data/preferences.svelte";
	import * as Item from "$lib/components/ui/item";
	import * as ToggleGroup from "$lib/components/ui/toggle-group";
	import type { UnitSystem } from "$lib/util/units";

	let pending = $state<UnitSystem | null>(null);
	const value = $derived(pending ?? preferencesSnapshot().units);
</script>

<Item.Root variant="outline" class="gap-3 p-4">
	<Item.Content class="gap-1">
		<Item.Title>Unidades</Item.Title>
		<Item.Description>
			Cómo se muestran la distancia, la altura y el peso.
		</Item.Description>
	</Item.Content>
	<ToggleGroup.Root
		type="single"
		variant="outline"
		class="w-full"
		bind:value={
			() => value,
			(next: string) => {
				const units = (next || "metric") as UnitSystem;
				pending = units;
				setPreferences({ units }).catch((error) => {
					pending = null;
					showErrorToast({
						label: "No se pudo guardar el ajuste",
						error,
					});
				});
			}
		}
	>
		<ToggleGroup.Item value="metric" class="flex-1 justify-center">
			Métrico
		</ToggleGroup.Item>
		<ToggleGroup.Item value="imperial" class="flex-1 justify-center">
			Imperial
		</ToggleGroup.Item>
	</ToggleGroup.Root>
</Item.Root>
