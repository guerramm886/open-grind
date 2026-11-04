<script lang="ts">
	import ImageIcon from "phosphor-svelte/lib/ImageIcon";
	import { z } from "zod";

	import { fetchRest } from "$lib/api/transport";
	import AlbumPreview from "$lib/components/album/AlbumPreview.svelte";
	import * as Dialog from "$lib/components/ui/dialog";
	import { mediaUrlSchema } from "$lib/model/media";
	import { proxyMediaUrl } from "$lib/util/media";
	import { getConversationState } from "../conversation-state.svelte";

	const imageSchema = z.object({ mediaId: z.number(), url: mediaUrlSchema });
	const albumSchema = z.object({
		albumId: z.number(),
		albumViewable: z.boolean(),
		content: z.object({ coverUrl: mediaUrlSchema.nullable() }).nullish(),
		contentCount: z
			.object({ imageCount: z.number(), videoCount: z.number() })
			.nullish(),
	});
	const conversation = $derived(getConversationState()());
	let open = $state(false);
	let images = $state<z.infer<typeof imageSchema>[] | null>(null);
	let albums = $state<z.infer<typeof albumSchema>[] | null>(null);
	let failure = $state(false);
	let activeImage = $state<string | null>(null);

	async function load() {
		if (!conversation.profile) return;
		images = null;
		albums = null;
		failure = false;
		const [imageResult, albumResult] = await Promise.allSettled([
			fetchRest(
				`/v5/chat/media/shared/images/with-me/${encodeURIComponent(conversation.conversationId)}`,
			).then(
				(res) =>
					res.jsonParsed(z.object({ images: z.array(imageSchema) }))
						.images,
			),
			fetchRest(
				`/v2/albums/shares/${conversation.profile.profileId}`,
			).then(
				(res) =>
					res.jsonParsed(z.object({ albums: z.array(albumSchema) }))
						.albums,
			),
		]);
		images = imageResult.status === "fulfilled" ? imageResult.value : [];
		albums = albumResult.status === "fulfilled" ? albumResult.value : [];
		failure =
			imageResult.status === "rejected" ||
			albumResult.status === "rejected";
	}
	$effect(() => {
		if (open) void load();
		else activeImage = null;
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger aria-label="Media recibida" class="rounded-full p-3"
		><ImageIcon class="size-6" /></Dialog.Trigger
	>
	<Dialog.Content showCloseButton>
		<Dialog.Title>Media recibida</Dialog.Title>
		<Dialog.Description
			>Fotos y álbumes que esta persona compartió con vos.</Dialog.Description
		>
		{#if failure}
			<p role="alert">No se pudo cargar toda la media.</p>
			<button type="button" onclick={load}>Reintentar</button>
		{/if}
		{#if images === null || albums === null}
			<p>Cargando…</p>
		{:else if activeImage}
			<button type="button" onclick={() => (activeImage = null)}
				>Volver a la media</button
			>
			<img
				src={proxyMediaUrl(activeImage)}
				alt="Foto recibida"
				class="max-h-[70vh] w-full object-contain"
			/>
		{:else}
			{#if !failure && !images.length && !albums.length}<p>
					No hay media compartida disponible.
				</p>{/if}
			<div class="grid grid-cols-3 gap-2">
				{#each images as item (item.mediaId)}
					<button
						type="button"
						aria-label="Abrir foto recibida"
						onclick={() => (activeImage = item.url)}
					>
						<img
							src={proxyMediaUrl(item.url)}
							alt=""
							class="aspect-square w-full rounded-lg object-cover"
						/>
					</button>
				{/each}
				{#each albums as album (album.albumId)}
					{#if album.albumViewable}
						<AlbumPreview
							albumId={album.albumId}
							coverUrl={album.content?.coverUrl ?? null}
							hasPhoto={(album.contentCount?.imageCount ?? 0) > 0}
							hasVideo={(album.contentCount?.videoCount ?? 0) > 0}
							label="Abrir álbum recibido"
							class="aspect-square w-full rounded-lg"
						/>
					{/if}
				{/each}
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
