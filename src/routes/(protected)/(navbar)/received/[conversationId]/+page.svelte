<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import ArrowLeftIcon from "phosphor-svelte/lib/ArrowLeftIcon";
	import DownloadSimpleIcon from "phosphor-svelte/lib/DownloadSimpleIcon";
	import XIcon from "phosphor-svelte/lib/XIcon";
	import { untrack } from "svelte";

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
		loadReceivedMedia,
		type ReceivedMediaResult,
	} from "$lib/received/received-media";
	import {
		GALLERY_FOLDER,
		saveItemToDevice,
	} from "$lib/received/save-to-device";
	import { topChrome } from "$lib/util/screen-chrome.svelte";
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

	$effect(() => {
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
			void receivedArchive.saveMany(
				items.filter((i) => i.available).map(archivableFromItem),
			);
		});
	});

	async function saveAllToGallery() {
		if (!result || savingAll) return;
		const items = result.items.filter((i) => i.available);
		if (items.length === 0) return;
		savingAll = true;
		savedDone = 0;
		savedTotal = items.length;
		saveResult = null;
		let failed = 0;
		for (const item of items) {
			try {
				await saveItemToDevice(item);
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

	// Cross this person out (hidden everywhere, like a block) and go back to the
	// Recibidos grid, where they'll no longer appear.
	function crossUser() {
		const profileId = result?.profile?.profileId;
		if (profileId === undefined) return;
		swipeDecisions.cross(profileId);
		void goto("/received");
	}

	let viewIndex = $state(-1);
</script>

<ProgressiveBlur
	direction="topToBottom"
	tag="nav"
	aria-label="Recibidos"
	data-fixed-header
	class="fixed top-0 left-0 z-10 w-full px-4 pt-fixed-header pb-2"
	bgClass="bg-linear-to-b from-background to-transparent"
	contentClass="flex flex-col gap-2 w-full max-w-120 mx-auto"
	{@attach topChrome}
>
	<div class="flex h-10 items-center gap-2">
		<a
			href="/received"
			aria-label="Volver"
			class="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-input/30"
		>
			<ArrowLeftIcon class="size-5" />
		</a>
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
				{#if result?.profile?.distance != null}
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
			aria-label="Cruzar y volver"
			disabled={!result?.profile}
			class="flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-destructive/70 bg-card/70 text-destructive transition active:scale-90 disabled:opacity-40"
			onclick={crossUser}
		>
			<XIcon weight="bold" class="size-5" />
		</button>
	</div>
	<div class="flex flex-wrap items-center gap-2">
		<button
			type="button"
			disabled={savingAll || !result || result.items.length === 0}
			class="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow transition active:scale-95 active:brightness-90 disabled:opacity-50"
			onclick={() => void saveAllToGallery()}
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

<main class="screen-nav-host">
	<div class="pull-scroller">
		<div
			class="mx-auto mt-14 min-h-overscrollable w-full max-w-120 px-2 pt-header-clear-16 pb-nav-clear"
		>
			{#if !receivedArchive.supported}
				<p
					class="mx-2 mb-2 rounded-md bg-amber-500/15 px-3 py-2 text-2xs text-amber-200"
				>
					Este dispositivo no permite guardar copias locales; se mostrará
					el contenido en vivo.
				</p>
			{/if}
			{#if loading && !result}
				<div class="grid grid-cols-3 gap-1">
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
				<div class="grid grid-cols-3 gap-1">
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
