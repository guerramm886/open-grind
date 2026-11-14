<script lang="ts">
	import { addMediaToDrawer } from "$lib/api/messaging/chat-media";
	import { showErrorToast } from "$lib/api/error-toast";
	import { mediaSets } from "$lib/chat/media-sets.svelte";
	import { Button } from "$lib/components/ui/button";
	import { pickMultipleMedia } from "$lib/platform/media-picker";
	import { proxyMediaUrl } from "$lib/util/media";
	import { getMessageComposerContext } from "../../message-composer-context.svelte";
	import { mediaMessageDraft } from "../media/media-messages";

	let { onClose }: { onClose: () => void } = $props();

	const composer = getMessageComposerContext();
	let addingTo = $state<string | null>(null);
	let newName = $state("");

	async function addPhotos(setId: string) {
		if (addingTo !== null) return;
		addingTo = setId;
		try {
			const picked = await pickMultipleMedia("media");
			const existing = mediaSets.sets.find((set) => set.id === setId);
			if (!existing) return;
			let items = [...existing.items];
			for (const item of picked) {
				try {
					items = [...items, await addMediaToDrawer(item)];
					mediaSets.setItems(setId, items);
				} catch (error) {
					showErrorToast({
						label: "No se pudo subir la foto",
						error,
					});
				}
			}
		} catch (error) {
			console.error(error);
		} finally {
			addingTo = null;
		}
	}

	function send(setId: string) {
		const set = mediaSets.sets.find((item) => item.id === setId);
		if (!set || set.items.length === 0) return;
		onClose();
		void composer().sendMessages(
			set.items.map((item) =>
				mediaMessageDraft({ item, expiring: false }),
			),
		);
	}

	function removeItem(setId: string, mediaId: number) {
		const set = mediaSets.sets.find((item) => item.id === setId);
		if (!set) return;
		mediaSets.setItems(
			setId,
			set.items.filter((item) => item.id !== mediaId),
		);
	}

	function createSet() {
		if (newName.trim() === "") return;
		mediaSets.create(newName);
		newName = "";
	}
</script>

<div class="flex flex-col gap-3 p-1">
	<div class="flex gap-2">
		<input
			bind:value={newName}
			placeholder="Nombre del set"
			class="min-w-0 flex-1 rounded-lg bg-secondary px-2 py-1.5 text-base"
		/>
		<Button size="sm" onclick={createSet}>+ Nuevo</Button>
	</div>

	{#if mediaSets.sets.length === 0}
		<p class="py-6 text-center text-sm text-muted-foreground">
			Creá un set y agregale fotos para mandarlas todas juntas a cualquier
			chat.
		</p>
	{/if}

	{#each mediaSets.sets as set (set.id)}
		<div class="rounded-xl border p-2">
			<div class="mb-2 flex items-center gap-2">
				<input
					value={set.name}
					onchange={(event) =>
						mediaSets.rename(set.id, event.currentTarget.value)}
					class="min-w-0 flex-1 bg-transparent text-sm font-semibold"
				/>
				<button
					type="button"
					class="shrink-0 text-xs text-destructive"
					onclick={() => mediaSets.remove(set.id)}
				>
					Borrar
				</button>
			</div>
			<div class="flex flex-wrap gap-1.5">
				{#each set.items as item (item.id)}
					<div class="relative size-14 overflow-hidden rounded-md">
						<img
							src={proxyMediaUrl(item.url)}
							alt=""
							class="size-full object-cover"
						/>
						<button
							type="button"
							aria-label="Quitar foto"
							class="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-black/70 text-2xs text-white"
							onclick={() => removeItem(set.id, item.id)}
						>
							✕
						</button>
					</div>
				{/each}
				<button
					type="button"
					disabled={addingTo === set.id}
					aria-label="Agregar fotos al set"
					class="flex size-14 items-center justify-center rounded-md border border-dashed border-border text-xl text-muted-foreground disabled:opacity-50"
					onclick={() => void addPhotos(set.id)}
				>
					{addingTo === set.id ? "…" : "+"}
				</button>
			</div>
			<Button
				size="sm"
				class="mt-2 w-full"
				disabled={set.items.length === 0}
				onclick={() => send(set.id)}
			>
				Enviar {set.items.length} foto(s)
			</Button>
		</div>
	{/each}
</div>
