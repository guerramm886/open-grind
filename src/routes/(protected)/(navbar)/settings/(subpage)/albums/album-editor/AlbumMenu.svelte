<script lang="ts">
	import DotsThreeVerticalIcon from "phosphor-svelte/lib/DotsThreeVerticalIcon";
	import TrashIcon from "phosphor-svelte/lib/TrashIcon";
	import { toast } from "svelte-sonner";

	import { getMyAlbumsState } from "$lib/albums/my-albums-state.svelte";
	import { showErrorToast } from "$lib/api/error-toast";
	import { deleteAlbum } from "$lib/api/messaging/albums";
	import * as AlertDialog from "$lib/components/ui/alert-dialog";
	import { Button } from "$lib/components/ui/button";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
	import { leaveDeletedPages } from "$lib/util/deleted-pages";

	let {
		albumId,
		ourProfileId,
		saving = false,
	}: { albumId: number; ourProfileId: number; saving?: boolean } = $props();

	let confirming = $state(false);
	let deleting = $state(false);

	async function remove() {
		deleting = true;
		try {
			await deleteAlbum({ albumId });
			getMyAlbumsState(ourProfileId).remove(albumId);
			toast.success("Se borró el álbum");
			leaveDeletedPages({
				pathnames: [`/settings/albums/${albumId}`],
				parent: "/settings/albums",
			});
		} catch (error) {
			console.error(error);
			showErrorToast({ label: "No se pudo borrar el álbum", error });
		} finally {
			deleting = false;
		}
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="ghost"
				size="icon-lg"
				class="size-12"
				aria-label="Menú del álbum"
				disabled={deleting || saving}
			>
				<DotsThreeVerticalIcon class="size-6" />
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end">
		<DropdownMenu.Item
			variant="destructive"
			onSelect={() => (confirming = true)}
		>
			<TrashIcon class="size-5" />
			Borrar álbum
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
<AlertDialog.Root bind:open={confirming}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Borrar álbum?</AlertDialog.Title>
			<AlertDialog.Description>
				Se borra el álbum con todo lo que tiene, y las personas con las que
				lo compartiste dejan de verlo. No se puede deshacer.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel size="lg">Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				variant="destructive"
				size="lg"
				onclick={() => {
					confirming = false;
					void remove();
				}}
			>
				Delete
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
