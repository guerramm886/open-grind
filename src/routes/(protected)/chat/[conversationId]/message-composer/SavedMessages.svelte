<script lang="ts">
	import { z } from "zod";

	import { signedInProfileId } from "$lib/api/current-session";
	import { showErrorToast } from "$lib/api/error-toast";
	import {
		type DrawerMedia,
		getAllDrawerMedia,
	} from "$lib/api/messaging/drawer";
	import MediaSheet from "$lib/components/media-sheet/MediaSheet.svelte";
	import MediaSheetBody from "$lib/components/media-sheet/MediaSheetBody.svelte";
	import * as Drawer from "$lib/components/ui/drawer";
	import { draftFromMessage } from "$lib/model/messaging/messages";
	import { proxyMediaUrl } from "$lib/util/media";
	import { mediaMessageDraft } from "./attachments/media/media-messages";
	import { getMessageComposerContext } from "./message-composer-context.svelte";

	type Saved = { id: string; text: string; mediaIds: number[] };
	const savedSchema = z.array(
		z.object({
			id: z.string(),
			text: z.string(),
			mediaIds: z.array(z.number().int()),
		}),
	);
	let {
		open = $bindable(),
		onCloseAutoFocus,
	}: { open: boolean; onCloseAutoFocus?: (event: Event) => void } = $props();
	const composer = getMessageComposerContext();
	let key = $state<string | null>(null);
	let saved = $state<Saved[]>([]);
	let media = $state<DrawerMedia[] | null>(null);
	let editing = $state(false);
	let text = $state("");
	let selected = $state<number[]>([]);
	let busy = $state(false);
	let error = $state("");

	async function load() {
		error = "";
		try {
			const profileId = await signedInProfileId();
			if (profileId === null) throw new Error("No hay una cuenta activa");
			key = `open-grind-saved-messages-${profileId}`;
			const data: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
			saved = savedSchema.parse(data);
			media = (await getAllDrawerMedia()).filter((item) =>
				item.contentType.startsWith("image/"),
			);
		} catch (failure) {
			console.error(failure);
			error =
				"No se pudieron cargar los mensajes o las fotos. Intentá de nuevo.";
		}
	}
	$effect(() => {
		if (open) void load();
	});

	function persist(next: Saved[]) {
		if (!key) return false;
		try {
			localStorage.setItem(key, JSON.stringify(next));
			saved = next;
			return true;
		} catch (failure) {
			showErrorToast({
				label: "No se pudo guardar el mensaje",
				error: failure,
			});
			return false;
		}
	}
	function add() {
		if (!text.trim() && !selected.length) return;
		if (
			persist([
				...saved,
				{
					id: crypto.randomUUID(),
					text: text.trim(),
					mediaIds: selected,
				},
			])
		) {
			text = "";
			selected = [];
			editing = false;
		}
	}
	async function send(entry: Saved) {
		if (busy || media === null) return;
		const photos = entry.mediaIds.map((id) =>
			media?.find((item) => item.id === id),
		);
		if (photos.some((item) => !item)) {
			error =
				"Falta una foto guardada. Eliminá este mensaje y crealo de nuevo.";
			return;
		}
		busy = true;
		try {
			await composer().sendMessages([
				...(entry.text
					? [
							draftFromMessage({
								type: "Text",
								body: { text: entry.text },
							}),
						]
					: []),
				...photos.map((item) =>
					mediaMessageDraft({ item: item!, expiring: false }),
				),
			]);
			open = false;
		} catch (failure) {
			showErrorToast({
				label: "No se pudo enviar el mensaje",
				error: failure,
			});
		} finally {
			busy = false;
		}
	}
</script>

<MediaSheet bind:open fullsize {onCloseAutoFocus}>
	<Drawer.Title class="sr-only">Mensajes guardados</Drawer.Title>
	<MediaSheetBody>
		<div class="space-y-3 pb-4">
			<h2 class="text-lg font-semibold">Mensajes guardados</h2>
			{#if error}<p role="alert">{error}</p>
				<button type="button" onclick={load}>Reintentar</button>{/if}
			{#each saved as entry (entry.id)}
				<div class="flex items-center gap-2 rounded-xl bg-card p-3">
					<button
						type="button"
						class="min-w-0 flex-1 text-left"
						disabled={busy || media === null}
						onclick={() => send(entry)}
						>{entry.text || "Mensaje con fotos"}
						{#if entry.mediaIds.length}· {entry.mediaIds.length} fotos{/if}</button
					>
					<button
						type="button"
						aria-label="Eliminar mensaje guardado"
						disabled={busy}
						onclick={() =>
							persist(
								saved.filter((item) => item.id !== entry.id),
							)}>✕</button
					>
				</div>
			{/each}
			{#if editing}
				<textarea
					aria-label="Texto del mensaje guardado"
					placeholder="Escribí un mensaje"
					bind:value={text}
					class="w-full rounded-xl bg-card p-3"
				></textarea>
				<p>Elegí fotos ya cargadas:</p>
				<div class="flex flex-wrap gap-2">
					{#each media ?? [] as item (item.id)}
						<button
							type="button"
							class="relative size-20 overflow-hidden rounded-lg"
							aria-label="Seleccionar foto"
							aria-pressed={selected.includes(item.id)}
							onclick={() =>
								(selected = selected.includes(item.id)
									? selected.filter((id) => id !== item.id)
									: [...selected, item.id])}
						>
							<img
								src={proxyMediaUrl(item.url, { as: "image" })}
								alt=""
								class="size-full object-cover"
							/>
							{#if selected.includes(item.id)}<span
									class="absolute inset-0 border-4 border-primary bg-primary/20"
								></span>{/if}
						</button>
					{/each}
				</div>
				<button
					type="button"
					class="rounded-full bg-primary px-4 py-2 text-primary-foreground"
					disabled={!key || (!text.trim() && !selected.length)}
					onclick={add}>Guardar</button
				>
				<button
					type="button"
					class="px-3 py-2"
					onclick={() => (editing = false)}>Cancelar</button
				>
			{:else}
				<button
					type="button"
					class="rounded-full bg-secondary px-4 py-2"
					disabled={!key}
					onclick={() => (editing = true)}>+ Agregar mensaje</button
				>
			{/if}
		</div>
	</MediaSheetBody>
</MediaSheet>
