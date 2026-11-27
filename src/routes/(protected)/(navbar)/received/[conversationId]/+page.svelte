<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import ArrowLeftIcon from "phosphor-svelte/lib/ArrowLeftIcon";
	import DownloadSimpleIcon from "phosphor-svelte/lib/DownloadSimpleIcon";
	import StarIcon from "phosphor-svelte/lib/StarIcon";
	import XIcon from "phosphor-svelte/lib/XIcon";
	import { untrack } from "svelte";
	import { toast } from "svelte-sonner";

	import {
		addFavoriteUser,
		removeFavoriteUser,
	} from "$lib/api/users/favorites";
	import BackLink from "$lib/components/navigation/BackLink.svelte";
	import { isWebServer } from "$lib/platform/os";
	import DistanceFormatted from "$lib/components/profile/DistanceFormatted.svelte";
	import UserAvatar from "$lib/components/profile/UserAvatar.svelte";
	import ProgressiveBlur from "$lib/components/shared/ProgressiveBlur.svelte";
	import { Skeleton } from "$lib/components/ui/skeleton";
	import { swipeDecisions } from "$lib/grid/swipe-decisions.svelte";
	import { receivedArchive } from "$lib/received/archive.svelte";
	import {
		getCachedReceived,
		setCachedReceived,
	} from "$lib/received/received-cache";
	import {
		archivableFromItem,
		ensureAlbumSavedLocally,
		loadReceivedMedia,
		type ReceivedMediaResult,
	} from "$lib/received/received-media";
	import {
		GALLERY_FOLDER,
		saveUrlToDevice,
	} from "$lib/received/save-to-device";
	import { canGoBack, returnTo } from "$lib/util/history";
	import { topChrome } from "$lib/util/screen-chrome.svelte";
	import { getReceivedPeople } from "../received-people.svelte";
	import ReceivedTile from "./ReceivedTile.svelte";
	import ReceivedViewer from "./ReceivedViewer.svelte";

	let { data }: import("./$types").PageProps = $props();

	const conversationId = $derived(page.params.conversationId ?? "");

	let result = $state<ReceivedMediaResult | null>(null);
	let loading = $state(true);
	let loadError = $state(false);
	let savingAll = $state(false);
	let savedDone = $state(0);
	let savedTotal = $state(0);
	let saveResult = $state<string | null>(null);

	let reloadTick = $state(0);
	let removingAlbum = $state<number | null>(null);
	let confirmingAlbum = $state<number | null>(null);

	// Opened from this person's chat (photo icon): back and the cross return to
	// the chat side instead of the Recibidos list.
	const fromChat = $derived(page.state.receivedOrigin === "chat");

	// Every album this person sent: still stored on Grindr ("En Grindr", counts
	// to its limit) or only as a copy kept in the app.
	type AlbumStatus = { albumId: number; inApi: boolean; sentAt: number };
	const albums = $derived.by(() => {
		const list: AlbumStatus[] = [];
		for (const item of result?.items ?? []) {
			if (item.source !== "album" || item.albumId === null) continue;
			const known = list.find((album) => album.albumId === item.albumId);
			if (known) {
				known.inApi ||= item.available;
				known.sentAt = Math.max(known.sentAt, item.timestamp);
			} else {
				list.push({
					albumId: item.albumId,
					inApi: item.available,
					sentAt: item.timestamp,
				});
			}
		}
		return list;
	});

	// Grindr doesn't let this app drop a received album, so the button checks
	// that the whole album is saved here; then it's safe to remove it from the
	// official app to free one of the slots.
	async function keepOnlyLocal(album: AlbumStatus) {
		if (removingAlbum !== null) return;
		const albumId = album.albumId;
		removingAlbum = albumId;
		confirmingAlbum = null;
		try {
			const count = await ensureAlbumSavedLocally({
				conversationId,
				albumId,
				profileId: result?.profile?.profileId ?? null,
				sentAt: album.sentAt,
			});
			toast.success(
				`Álbum completo guardado en la app (${count} archivos). Ya podés quitarlo desde Grindr.`,
				{ duration: 8000 },
			);
			reloadTick += 1;
		} catch (error) {
			console.error(error);
			toast.error(
				error instanceof Error && error.message
					? error.message
					: "No se pudo guardar el álbum completo",
			);
		} finally {
			removingAlbum = null;
		}
	}

	$effect(() => {
		void reloadTick;
		const id = conversationId;
		const ourId = data.ourProfileId;
		const cached = getCachedReceived(id);
		if (cached) {
			result = cached;
			loading = false;
		} else {
			loading = true;
			result = null;
		}
		loadError = false;
		let alive = true;
		void loadReceivedMedia({ conversationId: id, ourProfileId: ourId })
			.then((loaded) => {
				if (!alive) return;
				setCachedReceived(id, loaded);
				result = loaded;
				// When they last SENT something (profile photos have no date).
				const mediaAt = loaded.items.reduce(
					(max, item) =>
						item.source === "profile"
							? max
							: Math.max(max, item.timestamp),
					0,
				);
				receivedArchive.notePerson(id, {
					name: loaded.profile?.name ?? null,
					mediaHash: loaded.profile?.mediaHash ?? null,
					lastActivity: mediaAt > 0 ? mediaAt : undefined,
				});
				// Hide people from Recibidos once we confirm they have no
				// available SENT content (profile photos don't count).
				const sent = loaded.items.filter(
					(i) => i.source !== "profile" && i.available,
				).length;
				const people = getReceivedPeople(ourId);
				people.noteGallery(id, {
					albumInApi: loaded.items.some(
						(i) => i.source === "album" && i.available,
					),
					mediaAt,
				});
				// Don't hide people whose media we've already saved locally,
				// even if their live content is gone (locked album, etc.).
				if (sent === 0 && receivedArchive.archivedCount(id) === 0)
					people.markEmpty(id);
				else people.markHasContent(id);
			})
			.catch((error: unknown) => {
				console.error(error);
				if (alive && !cached) loadError = true;
			})
			.finally(() => {
				if (alive) loading = false;
			});
		return () => {
			alive = false;
		};
	});

	const savedCount = $derived(receivedArchive.archivedCount(conversationId));

	// Entering a person keeps a local copy of everything they sent (incl. album
	// contents), so it stays even if they delete it later.
	$effect(() => {
		const items = result?.items;
		if (!items || items.length === 0) return;
		untrack(() => {
			// Auto-keep an in-app copy of images so they survive
			// deletion/blocking/album-locking. Albums are kept whole (videos
			// too), so an album is already duplicated in the app before you
			// stop keeping it on Grindr. Loose chat videos are heavier and are
			// saved on demand via the buttons instead.
			// Videos too: nothing they sent should be lost.
			const keep = items.filter((i) => i.available);
			const sent = keep.filter((i) => i.source !== "profile");
			// Keep their profile photos locally too, but only for people who
			// actually sent you something; otherwise archive nothing.
			const toSave = sent.length > 0 ? keep : [];
			void receivedArchive.saveMany(toSave.map(archivableFromItem));
		});
	});

	let nameOpen = $state(false);
	let namePrefix = $state("perfil");

	function openSaveAll() {
		namePrefix =
			(result?.profile?.name || "perfil").replace(/[^a-z0-9_-]/gi, "_") ||
			"perfil";
		saveResult = null;
		nameOpen = true;
	}

	async function saveAllToGallery() {
		if (!result || savingAll) return;
		const items = result.items.filter((i) => i.available);
		if (items.length === 0) return;
		const prefix =
			(namePrefix.trim() || "perfil").replace(/[^a-z0-9_-]/gi, "_") ||
			"perfil";
		nameOpen = false;
		savingAll = true;
		savedDone = 0;
		savedTotal = items.length;
		saveResult = null;
		let failed = 0;
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (!item) continue;
			try {
				await saveUrlToDevice({
					rawUrl: item.rawUrl,
					baseName: `${prefix}-${i + 1}`,
					isVideo: item.kind === "video",
				});
			} catch (error) {
				failed += 1;
				console.error("[received] save failed", error);
			}
			savedDone += 1;
		}
		savingAll = false;
		saveResult =
			failed === 0
				? `✓ ${savedTotal} guardados en Galería › ${GALLERY_FOLDER}`
				: `Guardados ${savedTotal - failed}/${savedTotal} (fallaron ${failed})`;
		window.setTimeout(() => (saveResult = null), 6000);
	}

	// Cross this person out (hidden everywhere, like a block) and move on to the
	// NEXT person's grid in the current order, so you can keep going through the
	// list without bouncing back to Recibidos. Falls back to Recibidos only when
	// this was the last one.
	let confirmingCross = $state(false);

	// Crossing deletes their saved photos for good, so ask first when there
	// are any.
	function askCross() {
		if (savedCount > 0) confirmingCross = true;
		else crossUser();
	}

	function crossUser() {
		confirmingCross = false;
		const profileId = result?.profile?.profileId;
		if (profileId === undefined) return;
		// With nothing saved the cross loses nothing, so it can be undone.
		if (savedCount === 0)
			toast(`Cruzaste a ${result?.profile?.name || "este perfil"}`, {
				action: {
					label: "Deshacer",
					onClick: () => swipeDecisions.uncross(profileId),
				},
			});
		// Crossing someone out wipes everything of theirs kept on this device.
		void receivedArchive.forget(conversationId);
		// Pick the next person BEFORE crossing removes the current one.
		const list = getReceivedPeople(data.ourProfileId).visible;
		const idx = list.findIndex((p) => p.conversationId === conversationId);
		const next = idx === -1 ? undefined : list[idx + 1];
		swipeDecisions.cross(profileId);
		if (fromChat) {
			// Came from their chat: back to the chat list, not on to Recibidos.
			returnTo("/chat");
			return;
		}
		if (next)
			void goto(`/received/${next.conversationId}`, {
				replaceState: true,
			});
		else if (canGoBack()) history.back();
		else void goto("/received", { replaceState: true });
	}

	// Favorite state (optimistic), seeded from the scanned person.
	let favoriteOverride = $state<boolean | null>(null);
	const isFavorite = $derived(
		favoriteOverride ??
			getReceivedPeople(data.ourProfileId).visible.find(
				(person) => person.conversationId === conversationId,
			)?.favorite ??
			false,
	);
	let favoriting = $state(false);

	// The star only toggles favorite — unlike the cross, it does NOT advance to
	// the next person. You move on by swiping.
	async function toggleFavorite() {
		const profileId = result?.profile?.profileId;
		if (profileId === undefined || favoriting) return;
		const next = !isFavorite;
		favoriting = true;
		favoriteOverride = next;
		try {
			if (next) await addFavoriteUser({ profileId });
			else await removeFavoriteUser({ profileId });
		} catch (error) {
			console.error("[received] favorite failed", error);
			favoriteOverride = !next;
		} finally {
			favoriting = false;
		}
	}

	let viewIndex = $state(-1);

	// Swiping sideways on the photo GRID jumps to the adjacent person, landing
	// on their grid. replaceState keeps the history flat, so the back button
	// always returns to the Recibidos list — never to the previous person you
	// swiped past.
	function goAdjacentGrid(dir: 1 | -1) {
		const list = getReceivedPeople(data.ourProfileId).visible;
		const idx = list.findIndex((p) => p.conversationId === conversationId);
		if (idx === -1) return;
		const next = list[idx + dir];
		if (next)
			void goto(`/received/${next.conversationId}`, {
				replaceState: true,
				// Keep where we came from, so back still returns there.
				state: page.state,
			});
	}

	let mainEl = $state<HTMLElement | null>(null);
	let swipeStartX: number | null = null;
	let swipeStartY = 0;
	let lastSwipeAt = 0;

	// Touch events (not pointer): a horizontal swipe gets interpreted as a
	// scroll and cancels the pointer before pointerup fires, so pointer-based
	// detection never triggered. touchend always fires at the end of a touch.
	function onGridTouchStart(event: TouchEvent) {
		const touch = event.changedTouches[0];
		swipeStartX = touch?.clientX ?? null;
		swipeStartY = touch?.clientY ?? 0;
	}

	function onGridTouchEnd(event: TouchEvent) {
		if (swipeStartX === null) return;
		const touch = event.changedTouches[0];
		const dx = (touch?.clientX ?? swipeStartX) - swipeStartX;
		const dy = (touch?.clientY ?? swipeStartY) - swipeStartY;
		swipeStartX = null;
		// Needs enough horizontal travel, and clearly more sideways than
		// vertical, so normal up/down scrolling never triggers a jump.
		if (Math.abs(dx) < 60) return;
		if (Math.abs(dx) < Math.abs(dy) * 1.3) return;
		lastSwipeAt = Date.now();
		goAdjacentGrid(dx < 0 ? 1 : -1);
	}

	// Home Assistant (web on a PC): the same swipe with the mouse — drag
	// sideways — or the keyboard arrows, or a sideways scroll on a touchpad.
	const onPc = isWebServer();
	let dragStartX: number | null = null;
	let dragStartY = 0;
	function onGridPointerDown(event: PointerEvent) {
		if (!onPc || event.pointerType !== "mouse" || event.button !== 0) return;
		dragStartX = event.clientX;
		dragStartY = event.clientY;
	}
	function onGridPointerUp(event: PointerEvent) {
		if (dragStartX === null) return;
		const dx = event.clientX - dragStartX;
		const dy = event.clientY - dragStartY;
		dragStartX = null;
		if (Math.abs(dx) < 80 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
		lastSwipeAt = Date.now();
		goAdjacentGrid(dx < 0 ? 1 : -1);
	}
	let wheelAccum = 0;
	let wheelResetAt = 0;
	function onGridWheel(event: WheelEvent) {
		if (!onPc || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
		const now = Date.now();
		if (now - wheelResetAt > 400) wheelAccum = 0;
		wheelResetAt = now;
		wheelAccum += event.deltaX;
		if (Math.abs(wheelAccum) < 150 || now - lastSwipeAt < 800) return;
		lastSwipeAt = now;
		goAdjacentGrid(wheelAccum > 0 ? 1 : -1);
		wheelAccum = 0;
	}
	$effect(() => {
		if (!onPc) return;
		const onKey = (event: KeyboardEvent) => {
			if (viewIndex !== -1 || event.defaultPrevented) return;
			if (event.altKey || event.ctrlKey || event.metaKey) return;
			const target = event.target as HTMLElement | null;
			if (target?.closest("input, textarea, [contenteditable='true']")) return;
			if (event.key === "ArrowRight") goAdjacentGrid(1);
			else if (event.key === "ArrowLeft") goAdjacentGrid(-1);
			else return;
			event.preventDefault();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	// Swallow the click a swipe leaves behind, so releasing over a tile doesn't
	// also pop its photo open as we navigate to the next person.
	$effect(() => {
		const el = mainEl;
		if (!el) return;
		const onClickCapture = (event: MouseEvent) => {
			if (Date.now() - lastSwipeAt < 400) {
				event.stopPropagation();
				event.preventDefault();
			}
		};
		el.addEventListener("click", onClickCapture, true);
		return () => el.removeEventListener("click", onClickCapture, true);
	});
</script>

<ProgressiveBlur
	direction="topToBottom"
	tag="nav"
	aria-label="Recibidos"
	data-fixed-header
	class="fixed top-0 left-0 z-10 w-full px-4 pt-fixed-header pb-2"
	bgClass="bg-linear-to-b from-background to-transparent"
	contentClass="flex flex-col gap-2 w-full max-w-120 lg:max-w-400 mx-auto"
	{@attach topChrome}
>
	<div class="flex h-10 items-center gap-2">
		<BackLink
			href={fromChat ? `/chat/${conversationId}` : "/received"}
			label={fromChat ? "Volver al chat" : "Volver a Recibidos"}
			class="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-input/30"
		>
			<ArrowLeftIcon class="size-5" />
		</BackLink>
		{#snippet identity()}
			<div class="size-9 shrink-0 overflow-hidden rounded-full">
				<UserAvatar
					mediaHash={result?.profile?.mediaHash ?? null}
					class="size-full"
					size="md"
				/>
			</div>
			<div class="min-w-0 flex-1 text-start">
				<p class="truncate text-sm font-semibold">
					{result?.profile?.name ?? "Perfil"}
				</p>
				{#if typeof result?.profile?.distance === "number"}
					<p class="text-2xs text-muted-foreground">
						<DistanceFormatted distance={result.profile.distance} />
					</p>
				{/if}
			</div>
		{/snippet}
		{#if result?.profile}
			<a
				href="/profile/{result.profile.profileId}"
				class="flex min-w-0 flex-1 items-center gap-2"
			>
				{@render identity()}
			</a>
		{:else}
			<div class="flex min-w-0 flex-1 items-center gap-2">
				{@render identity()}
			</div>
		{/if}
		{#if savedCount > 0}
			<span class="text-2xs text-green-400">{savedCount} guardados</span>
		{/if}
		<button
			type="button"
			aria-label={isFavorite ? "Quitar de favoritos" : "Agregar a favoritos"}
			aria-checked={isFavorite}
			role="switch"
			disabled={!result?.profile || favoriting}
			class="flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-yellow-500/70 bg-card/70 transition active:scale-90 disabled:opacity-40"
			onclick={() => void toggleFavorite()}
		>
			<StarIcon
				weight={isFavorite ? "fill" : "bold"}
				class={[
				"size-5",
				{ "text-yellow-400": isFavorite, "text-white": !isFavorite },
			]}
			/>
		</button>
		<button
			type="button"
			aria-label="Cruzar"
			disabled={!result?.profile}
			class="flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-destructive/70 bg-card/70 text-destructive transition active:scale-90 disabled:opacity-40"
			onclick={askCross}
		>
			<XIcon weight="bold" class="size-5" />
		</button>
	</div>
	{#if confirmingCross}
		<div class="flex flex-col gap-2 rounded-xl bg-destructive/15 p-2.5">
			<p class="text-xs font-medium">
				Cruzar a esta persona borra para siempre sus {savedCount} archivos
				guardados en la app.
			</p>
			<div class="flex justify-end gap-2">
				<button
					type="button"
					class="rounded-full bg-secondary px-3 py-1.5 text-xs font-medium"
					onclick={() => (confirmingCross = false)}
				>
					Cancelar
				</button>
				<button
					type="button"
					class="rounded-full bg-destructive px-3 py-1.5 text-xs font-semibold text-white"
					onclick={crossUser}
				>
					Cruzar y borrar
				</button>
			</div>
		</div>
	{/if}
	<div class="flex flex-wrap items-center gap-2">
		{#if !nameOpen}
			<button
				type="button"
				disabled={savingAll || !result || result.items.length === 0}
				class="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow transition active:scale-95 active:brightness-90 disabled:opacity-50"
				onclick={openSaveAll}
			>
				<DownloadSimpleIcon weight="bold" class="size-4" />
				{#if savingAll}
					Guardando {savedDone}/{savedTotal}…
				{:else}
					Guardar todo en galería
				{/if}
			</button>
			<span class="text-2xs text-muted-foreground">
				Se guardan en Galería › {GALLERY_FOLDER}
			</span>
		{:else}
			<div class="flex w-full flex-col gap-1.5">
				<label for="save-prefix" class="text-xs font-medium">
					Guardar con nombre:
				</label>
				<input
					id="save-prefix"
					bind:value={namePrefix}
					class="w-full rounded-lg bg-secondary px-2 py-1.5 text-base"
				/>
				<p class="text-2xs text-muted-foreground">
					En Galería › {GALLERY_FOLDER}, como {namePrefix.trim() ||
						"perfil"}-1, -2, …
				</p>
				<div class="flex justify-end gap-2">
					<button
						type="button"
						class="rounded-full bg-secondary px-3 py-1.5 text-sm font-medium"
						onclick={() => (nameOpen = false)}
					>
						Cancelar
					</button>
					<button
						type="button"
						class="flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition active:scale-95"
						onclick={() => void saveAllToGallery()}
					>
						<DownloadSimpleIcon weight="bold" class="size-4" />
						Guardar en galería
					</button>
				</div>
			</div>
		{/if}
	</div>
	{#if savingAll || saveResult}
		<div
			class="rounded-lg bg-black/80 px-3 py-1.5 text-xs font-medium text-white"
		>
			{#if savingAll}
				Guardando en Galería › {GALLERY_FOLDER}… {savedDone}/{savedTotal}
			{:else}
				{saveResult}
			{/if}
		</div>
	{/if}
</ProgressiveBlur>

<main
	class="screen-nav-host"
	bind:this={mainEl}
	ontouchstart={onGridTouchStart}
	ontouchend={onGridTouchEnd}
	onpointerdown={onGridPointerDown}
	onpointerup={onGridPointerUp}
	onwheel={onGridWheel}
	ondragstart={(event) => {
		// A mouse drag is a swipe here, not dragging the photo out.
		if (onPc) event.preventDefault();
	}}
>
	<div class="pull-scroller">
		<div
			class="mx-auto min-h-overscrollable mt-14 w-full max-w-120 lg:max-w-400 px-2 pt-header-clear-16 pb-nav-clear"
		>
			{#if !receivedArchive.supported}
				<p
					class="mx-2 mb-2 rounded-md bg-amber-500/15 px-3 py-2 text-2xs text-amber-200"
				>
					Este dispositivo no permite guardar copias locales; se
					mostrará el contenido en vivo.
				</p>
			{/if}
			{#if loading && !result}
				<div class="grid grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8">
					{#each Array(9)}
						<Skeleton class="aspect-square rounded-none" />
					{/each}
				</div>
			{:else if loadError}
				<p class="py-8 text-center text-sm text-muted-foreground">
					No se pudo cargar el contenido.
				</p>
			{:else if !result || result.items.length === 0}
				<p class="py-8 text-center text-sm text-muted-foreground">
					Esta persona todavía no te envió fotos, videos ni álbumes
					(dentro de los mensajes recientes).
				</p>
			{:else}
				{#if albums.length > 0}
					<div class="mx-1 mb-2 flex flex-col gap-2">
						<div class="flex flex-wrap gap-2">
							{#each albums as album, i (album.albumId)}
								{#if album.inApi}
									<button
										type="button"
										aria-pressed="true"
										disabled={removingAlbum !== null}
										class="flex items-center gap-1.5 rounded-full bg-yellow-400 px-3 py-1.5 text-xs font-semibold text-black shadow-[0_0_14px_rgba(250,204,21,0.75)] transition active:scale-95 disabled:opacity-60"
										onclick={() =>
											(confirmingAlbum = album.albumId)}
									>
										<span
											class="size-2 rounded-full bg-black/70"
										></span>
										{#if removingAlbum === album.albumId}
											Álbum {i + 1} · guardando…
										{:else}
											Álbum {i + 1} · En Grindr
										{/if}
									</button>
								{:else}
									<span
										class="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground"
									>
										Álbum {i + 1} · solo en la app
									</span>
								{/if}
							{/each}
						</div>
						{#each albums as album (album.albumId)}
							{#if confirmingAlbum === album.albumId}
								<div
									class="flex flex-col gap-2 rounded-xl bg-secondary/60 p-2.5"
								>
									<p class="text-xs font-medium">
										Este álbum ocupa uno de tus lugares en Grindr.
									</p>
									<p class="text-2xs text-muted-foreground">
										Grindr no deja quitarlo desde esta app. Tocá
										“Guardar copia completa” y, cuando confirme,
										quitalo desde la app oficial de Grindr: acá lo
										vas a seguir viendo.
									</p>
									<div class="flex justify-end gap-2">
										<button
											type="button"
											class="rounded-full bg-secondary px-3 py-1.5 text-xs font-medium"
											onclick={() => (confirmingAlbum = null)}
										>
											Cancelar
										</button>
										<button
											type="button"
											class="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
											onclick={() => void keepOnlyLocal(album)}
										>
											Guardar copia completa
										</button>
									</div>
								</div>
							{/if}
						{/each}
					</div>
				{/if}
				<div class="grid grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8">
					{#each result.items as item, i (item.id)}
						<ReceivedTile {item} onOpen={() => (viewIndex = i)} />
					{/each}
				</div>
				{#if loading}
					<p class="py-3 text-center text-2xs text-muted-foreground">
						Buscando más…
					</p>
				{/if}
			{/if}
		</div>
	</div>
</main>

{#if viewIndex >= 0 && result && result.items.length > 0}
	<ReceivedViewer
		items={result.items}
		start={viewIndex}
		onClose={() => (viewIndex = -1)}
	/>
{/if}
