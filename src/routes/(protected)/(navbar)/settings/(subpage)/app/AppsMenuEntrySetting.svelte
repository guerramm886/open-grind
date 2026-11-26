<script lang="ts">
	import { showErrorToast } from "$lib/api/error-toast";
	import SwitchField from "$lib/components/ui/switch-field/SwitchField.svelte";
	import {
		desktopEntryInstalled,
		setDesktopEntryInstalled,
	} from "$lib/platform/desktop-entry.svelte";

	let pending = $state<boolean | null>(null);
	const value = $derived(pending ?? desktopEntryInstalled());
</script>

<SwitchField
	title="Mostrar en el menú de apps"
	description="Agrega Martin's Grindr a la lista de aplicaciones, con su ícono."
	bind:checked={
		() => value,
		(newValue: boolean) => {
			pending = newValue;
			setDesktopEntryInstalled(newValue)
				.catch((error: unknown) => {
					showErrorToast({
						label: newValue
							? "No se pudo agregar Martin's Grindr a tus apps"
							: "No se pudo sacar Martin's Grindr de tus apps",
						error,
					});
				})
				.finally(() => (pending = null));
		}
	}
/>
