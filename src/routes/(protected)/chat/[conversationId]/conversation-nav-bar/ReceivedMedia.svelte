<script lang="ts">
	import CaretLeftIcon from "phosphor-svelte/lib/CaretLeftIcon";
	import CaretRightIcon from "phosphor-svelte/lib/CaretRightIcon";
	import DownloadSimpleIcon from "phosphor-svelte/lib/DownloadSimpleIcon";
	import ImageIcon from "phosphor-svelte/lib/ImageIcon";
	import { toast } from "svelte-sonner";
	import { z } from "zod";

	import { getAlbumContent } from "$lib/api/messaging/albums";
	import { fetchRest } from "$lib/api/transport";
	import { getProfile } from "$lib/api/users/profiles";
	import { isVideoContent } from "$lib/components/album/album";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { mediaUrlSchema } from "$lib/model/media";
	import { receivedArchive } from "$lib/received/archive.svelte";
	import { keepAlbumOnlyLocally } from "$lib/received/received-media";
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
	});

	// One flat media item. `thumb` is what the grid shows (a video's cover),
	// `src` is what the viewer opens, `rawUrl` is the https URL for downloading
	// (null for a local-only copy that can't be re-fetched).
	type MediaTile = {
		thumb: string;
		src: string;
		rawUrl: string | null;
		isVideo: boolean;
	};

	const conversation = $derived(getConversationState()());
	let open = $state(false);
	let tiles = $state<MediaTile[] | null>(null);
	let albums = $state<number[]>([]);
	let removingAlbum = $state<number | null>(null);
	let confirmingAlbum = $state<number | null>(null);
	let failure = $state(false);
	let activeIndex = $state<number | null>(null);

	// Download-all with a chosen name.
	let downloadOpen = $state(false);
	let namePrefix = $state("perfil");
	let saving = $state(false);
	let savedDone = $state(0);
	let savedTotal = $state(0);
	let saveResult = $state<string | null>(null);

	async function archivedTiles(
		predicate: (albumId: number | null) => boolean,
	): Promise<MediaTile[]> {
		const out: MediaTile[] = [];
		const entries = receivedArchive
			.entriesFor(conversation.conversationId)
			.filter((entry) => entry.kind === "image" && predicate(entry.albumId));
		for (const entry of entries) {
			const url = await receivedArchive.objectUrl(entry.id);
			if (url) out.push({ thumb: url, src: url, rawUrl: null, isVideo: false });
		}
		return out;
	}

	async function load() {
		if (!conversation.profile) return;
		tiles = null;
		failure = false;
		const [imageResult, albumResult, profileResult] =
			await Promise.allSettled([
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
				getProfile(conversation.profile.profileId),
			]);

		const built: MediaTile[] = [];

		// 1. Direct photos they sent. If the live list is empty, fall back to
		// the locally saved direct copies (albumId null).
		const liveImages =
			imageResult.status === "fulfilled" ? imageResult.value : [];
		if (liveImages.length > 0) {
			for (const img of liveImages)
				built.push({
					thumb: proxyMediaUrl(img.url),
					src: proxyMediaUrl(img.url),
					rawUrl: img.url,
					isVideo: false,
				});
		} else {
			built.push(...(await archivedTiles((albumId) => albumId === null)));
		}

		// 2. Albums, expanded into individual photos/videos (not album covers).
		// A locked album falls back to its locally saved copies.
		const liveAlbums =
			albumResult.status === "fulfilled" ? albumResult.value : [];
		albums = liveAlbums
			.filter((album) => album.albumViewable)
			.map((album) => album.albumId);
		for (const album of liveAlbums) {
			if (!album.albumViewable) continue;
			let added = 0;
			try {
				const detail = await getAlbumContent(album.albumId);
				for (const content of detail.content) {
					if (content.processing) continue;
					const full = content.url || content.coverUrl || content.thumbUrl;
					if (!full) continue;
					const isVid = isVideoContent(content.contentType);
					const cover = isVid
						? content.coverUrl || content.thumbUrl || full
						: full;
					built.push({
						thumb: proxyMediaUrl(cover),
						src: proxyMediaUrl(full),
						rawUrl: full,
						isVideo: isVid,
					});
					added += 1;
				}
			} catch (error) {
				console.error("[received-media] album expand failed", error);
			}
			if (added === 0)
				built.push(
					...(await archivedTiles((albumId) => albumId === album.albumId)),
				);
		}
		// Saved copies of albums that are no longer in the share list at all.
		built.push(
			...(await archivedTiles(
				(albumId) =>
					albumId !== null &&
					!liveAlbums.some((album) => album.albumId === albumId),
			)),
		);

		// 3. Their public profile photos.
		if (profileResult.status === "fulfilled") {
			for (const media of profileResult.value.medias) {
				const url = `https://cdns.grindr.com/images/profile/1024x1024/${media.mediaHash}`;
				built.push({
					thumb: proxyMediaUrl(url),
					src: proxyMediaUrl(url),
					rawUrl: url,
					isVideo: false,
				});
			}
		}

		tiles = built;
		failure =
			imageResult.status === "rejected" &&
			albumResult.status === "rejected";
	}

	$effect(() => {
		if (open) void load();
		else {
			activeIndex = null;
			downloadOpen = false;
			saveResult = null;
		}
	});

	// TEST: archive an album's photos locally, then remove it from your side
	// (deleteAlbum) to free a slot — to check whether older locked albums then
	// become visible. The photos stay in the app ("Guardadas en la app").
	async function removeAlbum(albumId: number) {
		if (removingAlbum !== null || !conversation.profile) return;
		removingAlbum = albumId;
		confirmingAlbum = null;
		try {
			receivedArchive.notePerson(conversation.conversationId, {
				name: conversation.profile.name ?? null,
				mediaHash: conversation.profile.mediaHash ?? null,
			});
			await keepAlbumOnlyLocally({
				conversationId: conversation.conversationId,
				albumId,
				profileId: conversation.profile.profileId,
			});
			toast.success("Álbum borrado del API. Quedó guardado en la app.");
			await load();
		} catch (error) {
			console.error(error);
			toast.error(
				error instanceof Error && error.message
					? error.message
					: "No se pudo quitar el álbum del API",
			);
		} finally {
			removingAlbum = null;
		}
	}

	function go(delta: number) {
		if (activeIndex === null || !tiles) return;
		const next = activeIndex + delta;
		if (next >= 0 && next < tiles.length) activeIndex = next;
	}

	let touchX: number | null = null;
	let touchY = 0;
	function onTouchStart(event: TouchEvent) {
		const touch = event.changedTouches[0];
		touchX = touch?.clientX ?? null;
		touchY = touch?.clientY ?? 0;
	}
	function onTouchEnd(event: TouchEvent) {
		if (touchX === null) return;
		const touch = event.changedTouches[0];
		const dx = (touch?.clientX ?? touchX) - touchX;
		const dy = (touch?.clientY ?? touchY) - touchY;
		touchX = null;
		if (Math.abs(dx) < 50) return;
		if (Math.abs(dx) < Math.abs(dy) * 1.3) return;
		go(dx < 0 ? 1 : -1);
	}

	async function downloadCurrent() {
		if (activeIndex === null || !tiles) return;
		const tile = tiles[activeIndex];
		if (!tile?.rawUrl) return;
		try {
			await saveUrlToDevice({
				rawUrl: tile.rawUrl,
				baseName: `grindr-${Date.now()}`,
				isVideo: tile.isVideo,
			});
			saveResult = `✓ Guardado en Galería › ${GALLERY_FOLDER}`;
		} catch (error) {
			console.error("[received-media] save failed", error);
			saveResult = "No se pudo guardar";
		}
		window.setTimeout(() => (saveResult = null), 3000);
	}

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

	async function runDownload() {
		if (saving) return;
		saving = true;
		savedDone = 0;
		savedTotal = 0;
		saveResult = null;
		const prefix =
			(namePrefix.trim() || "perfil").replace(/[^a-z0-9_-]/gi, "_") ||
			"perfil";
		// Everything we have a real URL for (local-only copies can't be re-fetched).
		const targets = (tiles ?? []).filter((tile) => tile.rawUrl !== null);
		savedTotal = targets.length;
		if (targets.length === 0) {
			saving = false;
			saveResult = "No hay nada para descargar.";
			return;
		}
		let failed = 0;
		for (let i = 0; i < targets.length; i++) {
			const target = targets[i];
			if (!target?.rawUrl) continue;
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

	const activeTile = $derived(
		activeIndex !== null ? (tiles?.[activeIndex] ?? null) : null,
	);
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger aria-label="Media recibida" class="rounded-full p-3"
		><ImageIcon class="size-6" /></Dialog.Trigger
	>
	<Dialog.Content showCloseButton>
		<Dialog.Title>Media recibida</Dialog.Title>
		<Dialog.Description
			>Todo lo que esta persona compartió con vos.</Dialog.Description
		>

		{#if activeIndex === null}
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
						Guarda todo en Galería › {GALLERY_FOLDER}, como {namePrefix.trim() ||
							"perfil"}-1, -2, …
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
					<p class="text-xs font-medium text-green-500">
						{saveResult}
					</p>
				{/if}
			</div>
		{/if}

		{#if activeIndex === null && albums.length > 0}
			<div class="flex flex-col gap-1.5 rounded-xl bg-secondary/40 p-2">
				{#each albums as albumId, i (albumId)}
					<div class="flex flex-col gap-1">
						<label class="flex items-center gap-2 text-xs font-medium">
							<input
								type="checkbox"
								checked
								disabled={removingAlbum !== null}
								class="size-4 shrink-0"
								onclick={(event) => {
									event.preventDefault();
									confirmingAlbum = albumId;
								}}
							/>
							<span>
								Álbum {i + 1}: guardado en API
								{#if removingAlbum === albumId}
									— guardando y borrando…
								{/if}
							</span>
						</label>
						{#if confirmingAlbum === albumId}
							<p class="text-2xs text-muted-foreground">
								Se guarda todo en la app y después se borra del API de
								Grindr (no se puede deshacer). Vas a seguir viéndolo
								acá y en Recibidos.
							</p>
							<div class="flex gap-2">
								<Button
									size="sm"
									variant="secondary"
									onclick={() => (confirmingAlbum = null)}
								>
									Cancelar
								</Button>
								<Button
									size="sm"
									onclick={() => void removeAlbum(albumId)}
								>
									Dejar solo local
								</Button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		{#if failure}
			<p role="alert">No se pudo cargar toda la media.</p>
			<button type="button" onclick={load}>Reintentar</button>
		{/if}
		{#if tiles === null}
			<p>Cargando…</p>
		{:else if activeTile}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="relative"
				ontouchstart={onTouchStart}
				ontouchend={onTouchEnd}
			>
				{#if activeTile.isVideo}
					<!-- svelte-ignore a11y_media_has_caption -->
					<video
						src={activeTile.src}
						class="max-h-[70vh] w-full"
						controls
						autoplay
						playsinline
					></video>
				{:else}
					<img
						src={activeTile.src}
						alt=""
						class="max-h-[70vh] w-full object-contain"
					/>
				{/if}
				<!-- Tap the left/right half to change, so it doesn't fight the
				phone's edge gestures. -->
				{#if activeIndex !== null && activeIndex > 0}
					<button
						type="button"
						aria-label="Anterior"
						class="absolute inset-y-0 left-0 w-1/2"
						onclick={() => go(-1)}
					></button>
					<span
						class="pointer-events-none absolute top-1/2 left-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white"
					>
						<CaretLeftIcon class="size-5" />
					</span>
				{/if}
				{#if activeIndex !== null && tiles && activeIndex < tiles.length - 1}
					<button
						type="button"
						aria-label="Siguiente"
						class="absolute inset-y-0 right-0 w-1/2"
						onclick={() => go(1)}
					></button>
					<span
						class="pointer-events-none absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white"
					>
						<CaretRightIcon class="size-5" />
					</span>
				{/if}
			</div>
			<div class="flex items-center justify-between gap-2">
				<Button
					variant="secondary"
					size="sm"
					onclick={() => (activeIndex = null)}
				>
					Volver
				</Button>
				<span class="text-2xs text-muted-foreground">
					{(activeIndex ?? 0) + 1} / {tiles.length}
				</span>
				{#if activeTile.rawUrl}
					<Button size="sm" onclick={() => void downloadCurrent()}>
						<DownloadSimpleIcon weight="bold" class="size-4" />
						Descargar
					</Button>
				{:else}
					<span></span>
				{/if}
			</div>
			{#if saveResult}
				<p class="text-xs font-medium text-green-500">{saveResult}</p>
			{/if}
		{:else}
			{#if !failure && tiles.length === 0}<p>
					No hay media compartida disponible.
				</p>{/if}
			<div class="grid grid-cols-3 gap-2">
				{#each tiles as tile, i (i)}
					<button
						type="button"
						aria-label="Abrir contenido"
						class="relative"
						onclick={() => (activeIndex = i)}
					>
						<img
							src={tile.thumb}
							alt=""
							class="aspect-square w-full rounded-lg object-cover"
						/>
						{#if tile.isVideo}
							<span
								class="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-2xs font-semibold text-white"
							>
								▶
							</span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
