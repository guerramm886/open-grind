<script lang="ts">
	import * as AlertDialog from "$lib/components/ui/alert-dialog";
	import { dismissOnBackGesture } from "$lib/platform/back-gesture-event.svelte";
	import {
		continueToAddon,
		dismissAddonDialog,
	} from "$lib/push/delivery.svelte";
	import { notificationSettings } from "$lib/push/notification-state.svelte";
	import { installedFromFdroid } from "$lib/updates/capability.svelte";
	import { ADDON_NAME, FCM_COMPONENT } from "$lib/updates/components";

	let { onCloseAutoFocus }: { onCloseAutoFocus: (event: Event) => void } =
		$props();

	const ADDON = ADDON_NAME[FCM_COMPONENT];

	dismissOnBackGesture({
		active: () => notificationSettings.addonDialog !== null,
		dismiss: dismissAddonDialog,
	});
</script>

<AlertDialog.Root
	bind:open={
		() => notificationSettings.addonDialog !== null,
		(next) => {
			if (!next) dismissAddonDialog();
		}
	}
>
	<AlertDialog.Content interactOutsideBehavior="close" {onCloseAutoFocus}>
		<AlertDialog.Header>
			<AlertDialog.Title
				>Instalar el complemento de notificaciones</AlertDialog.Title
			>
			<AlertDialog.Description class="text-wrap">
				Para el modo rápido, descargá e instalá el complemento {ADDON}. Usa la
				biblioteca Firebase de Google y necesita los servicios de Google Play o
				microG, por eso no viene instalado.
				{#if installedFromFdroid()}
					Este complemento no pasa por los controles de F-Droid.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel size="lg">Cancelar</AlertDialog.Cancel>
			<AlertDialog.Action
				size="lg"
				onclick={() => void continueToAddon()}
			>
				Continuar
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
