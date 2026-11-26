<script lang="ts">
	import CaretRightIcon from "phosphor-svelte/lib/CaretRightIcon";
	import SignOutIcon from "phosphor-svelte/lib/SignOutIcon";

	import { signOut } from "$lib/api/sign-out";
	import * as AlertDialog from "$lib/components/ui/alert-dialog";
	import * as Item from "$lib/components/ui/item";
	import { Spinner } from "$lib/components/ui/spinner";
	import { dismissOnBackGesture } from "$lib/platform/back-gesture-event.svelte";
	import ButtonItemContent from "./ButtonItemContent.svelte";

	let alertOpen = $state(false);
	let signingOut = $state(false);

	const escapeKeydownBehavior = $derived(signingOut ? "ignore" : "close");

	dismissOnBackGesture({
		active: () => alertOpen,
		dismiss: () => {
			if (!signingOut) alertOpen = false;
		},
	});

	async function confirmSignOut() {
		signingOut = true;
		try {
			await signOut();
		} finally {
			signingOut = false;
			alertOpen = false;
		}
	}
</script>

<Item.Root variant="outline">
	{#snippet child({ props })}
		<ButtonItemContent
			{...props}
			variant="outline"
			onclick={() => (alertOpen = true)}
		>
			<Item.Media>
				<SignOutIcon weight="fill" class="size-5" />
			</Item.Media>
			<Item.Content class="min-w-0">
				<Item.Title
					class="inline-block w-full min-w-0 truncate text-left"
				>
					Cerrar sesión
				</Item.Title>
			</Item.Content>
			<Item.Actions>
				<CaretRightIcon class="size-4" />
			</Item.Actions>
		</ButtonItemContent>
	{/snippet}
</Item.Root>
<AlertDialog.Root bind:open={alertOpen}>
	<AlertDialog.Content {escapeKeydownBehavior}>
		<AlertDialog.Header>
			<AlertDialog.Title>¿Cerrar sesión?</AlertDialog.Title>
			<AlertDialog.Description>
				¿Seguro que querés cerrar sesión? Podés volver a entrar cuando
				quieras.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<fieldset disabled={signingOut} class="contents">
				<AlertDialog.Cancel size="lg">Cancelar</AlertDialog.Cancel>
				<AlertDialog.Action
					onclick={() => void confirmSignOut()}
					size="lg"
					aria-busy={signingOut}
				>
					{#if signingOut}
						<Spinner aria-hidden="true" />
					{/if}
					Continuar
				</AlertDialog.Action>
			</fieldset>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
