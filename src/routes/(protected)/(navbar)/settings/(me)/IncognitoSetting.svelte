<script lang="ts">
	import { onMount } from "svelte";

	import {
		getAccountPreferences,
		setAccountPreferences,
	} from "$lib/api/settings/account";
	import SwitchField from "$lib/components/ui/switch-field/SwitchField.svelte";

	// Grindr's own "incognito" account setting: while it is on, the server
	// stops listing us as online and keeps us out of other people's grids.
	let hidden = $state(false);
	let loaded = $state(false);
	let busy = $state(false);
	let problem = $state<string | null>(null);

	onMount(() => {
		getAccountPreferences()
			.then((preferences) => {
				hidden = preferences.incognito;
				loaded = true;
			})
			.catch((error) => {
				console.error("Failed to load account preferences", error);
				problem = "No se pudo leer el estado actual.";
			});
	});

	async function apply(next: boolean) {
		if (!loaded || busy) return;
		const previous = hidden;
		hidden = next;
		busy = true;
		problem = null;
		try {
			await setAccountPreferences({ incognito: next });
			// The server can answer OK and still ignore the change, so trust
			// only what it reports back.
			const confirmed = (await getAccountPreferences()).incognito;
			hidden = confirmed;
			if (confirmed !== next) {
				problem =
					"Grindr no aplicó el cambio. El modo oculto suele requerir una cuenta Unlimited.";
			}
		} catch (error) {
			console.error("Failed to change incognito", error);
			hidden = previous;
			problem =
				"Grindr rechazó el cambio. El modo oculto suele requerir una cuenta Unlimited.";
		} finally {
			busy = false;
		}
	}
</script>

<div>
	<SwitchField
		title={hidden ? "Oculto" : "Visible (aparezco online)"}
		description="Oculto: no aparecés online ni en la grilla de los demás. Seguís viendo perfiles y chateando normal."
		disabled={!loaded}
		{busy}
		bind:checked={() => hidden, (next: boolean) => void apply(next)}
	/>
	{#if problem}
		<p class="mt-1 px-4 text-2xs text-destructive">{problem}</p>
	{/if}
</div>
