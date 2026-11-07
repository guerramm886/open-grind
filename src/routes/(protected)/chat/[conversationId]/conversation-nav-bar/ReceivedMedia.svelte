<script lang="ts">
	import DownloadSimpleIcon from "phosphor-svelte/lib/DownloadSimpleIcon";
	import ImageIcon from "phosphor-svelte/lib/ImageIcon";
	import { z } from "zod";

	import { getAlbumContent } from "$lib/api/messaging/albums";
	import { fetchRest } from "$lib/api/transport";
	import { getProfile } from "$lib/api/users/profiles";
	import { isVideoContent } from "$lib/components/album/album";
	import AlbumPreview from "$lib/components/album/AlbumPreview.svelte";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { mediaUrlSchema } from "$lib/model/media";
	import { receivedArchive } from "$lib/received/archive.svelte";
	import {
		GALLERY_FOLDER,
		saveUrlToDevice,
	} from "$lib/received/save-to-device";
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

	// Download-all with a chosen name.
	let downloadOpen = $state(false);
	let namePrefix = $state("perfil");
	let saving = $state(false);
	let savedDone = $state(0);
	let savedTotal = $state(0);
	let saveResult = $state<string | null>(null);

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
		else {
			activeImage = null;
			downloadOpen = false;
			saveResult = null;
		}
	});

	async function openDownload() {
		downloadOpen = true;
		saveResult = null;
		const pid = conversation.profile?.profileId;
		let name = "perfil";
		if (pid !== undefined) {
			try {
				const profile = await getProfile(pid);
				name = profile.displayName || `perfil-${pid}`;
				receivedArchive.notePerson(conversation.conversationId, {
					name: profile.displayName,
					mediaHash: profile.medias[0]?.mediaHash ?? null,
				});
			} catch {
				name = `perfil-${pid}`;
			}
		}
		namePrefix = name;
	}

	// Everything this person shared with you: sent photos, album contents, and
	// their profile photos.
	async function collectTargets(): Promise<
		{ rawUrl: string; isVideo: boolean }[]
	> {
		const targets: { rawUrl: string; isVideo: boolean }[] = [];
		for (const img of images ?? []) {
			targets.push({ rawUrl: img.url, isVideo: false });
		}
		for (const album of albums ?? []) {
			if (!album.albumViewable) continue;
			try {
				const detail = await getAlbumContent(album.albumId);
				for (const c of detail.content) {
					if (c.processing) continue;
					const isVid = isVideoContent(c.contentType);
					const src = c.url || c.coverUrl || c.thumbUrl;
					if (src) targets.push({ rawUrl: src, isVideo: isVid });
				}
			} catch (error) {
				console.error("[received-media] album expand failed", error);
			}
		}
		const pid = conversation.profile?.profileId;
		if (pid !== undefined) {
			try {
				const profile = await getProfile(pid);
				for (const media of profile.medias) {
					targets.push({
						rawUrl: `https://cdns.grindr.com/images/profile/1024x1024/${media.mediaHash}`,
						isVideo: false,
					});
				}
			} catch (error) {
				console.error("[received-media] profile photos failed", error);
			}
		}
		return targets;
	}

	async function runDownload() {
		if (saving) return;
		saving = true;
		savedDone = 0;
		savedTotal = 0;
		saveResult = null;
		const prefix =
			(namePrefix.trim() || "perfil").replace(/[^a-z0-9_-]/gi, "_") ||
			"perfil";
		let targets: { url: string; isVideo: boolean }[] = [];
		try {
			targets = await collectTargets();
		} catch (error) {
			console.error(error);
		}
		savedTotal = targets.length;
		if (targets.length === 0) {
			saving = false;
			saveResult = "No hay nada para descargar.";
			return;
		}
		let failed = 0;
		for (let i = 0; i < targets.length; i++) {
			const target = targets[i];
			if (!target) continue;
			try {
				await saveUrlToDevice({
					rawUrl: target.rawUrl,
					baseName: `${prefix}-${i + 1}`,
					isVideo: target.isVideo,
				});
			} catch (error) {
				failed += 1;
				console.error("[received-media] save failed", error);
			}
			savedDone = i + 1;
		}
		saving = false;
		saveResult =
			failed === 0
				? `✓ ${savedTotal} guardados en Galería › ${GALLERY_FOLDER}`
				: `Guardados ${savedTotal - failed}/${savedTotal} (fallaron ${failed})`;
	}
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

		{#if !activeImage}
			<div class="flex flex-col gap-2 rounded-xl bg-secondary/40 p-2">
				{#if !downloadOpen}
					<Button size="sm" onclick={() => void openDownload()}>
						<DownloadSimpleIcon weight="bold" class="size-4" />
						Descargar todo
					</Button>
				{:else}
					<label class="text-xs font-medium" for="save-name">
						Guardar con nombre:
					</label>
					<input
						id="save-name"
						bind:value={namePrefix}
						class="w-full rounded-lg bg-background px-2 py-1.5 text-base"
					/>
					<p class="text-2xs text-muted-foreground">
						Guarda fotos enviadas, álbumes y fotos de perfil en Galería
						› {GALLERY_FOLDER}, como {namePrefix.trim() || "perfil"}-1,
						-2, …
					</p>
					<div class="flex justify-end gap-2">
						<Button
							variant="secondary"
							size="sm"
							disabled={saving}
							onclick={() => (downloadOpen = false)}
						>
							Cancelar
						</Button>
						<button
							type="button"
							disabled={saving}
							class="flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition active:scale-95 active:brightness-90 disabled:opacity-50"
							onclick={() => void runDownload()}
						>
							<DownloadSimpleIcon weight="bold" class="size-4" />
							{#if saving}
								Guardando {savedDone}/{savedTotal}…
							{:else}
								Guardar en galería
							{/if}
						</button>
					</div>
				{/if}
				{#if saveResult}
					<p class="text-xs font-medium text-green-500">{saveResult}</p>
				{/if}
			</div>
		{/if}

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
