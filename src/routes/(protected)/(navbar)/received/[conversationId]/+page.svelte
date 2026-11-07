<script lang="ts">
	import { page } from "$app/state";
	import ArrowLeftIcon from "phosphor-svelte/lib/ArrowLeftIcon";
	import DownloadSimpleIcon from "phosphor-svelte/lib/DownloadSimpleIcon";
	import XIcon from "phosphor-svelte/lib/XIcon";
	import { untrack } from "svelte";

	import DistanceFormatted from "$lib/components/profile/DistanceFormatted.svelte";
	import UserAvatar from "$lib/components/profile/UserAvatar.svelte";
	import ProgressiveBlur from "$lib/components/shared/ProgressiveBlur.svelte";
	import { Button } from "$lib/components/ui/button";
	import { Skeleton } from "$lib/components/ui/skeleton";
	import { receivedArchive } from "$lib/received/archive.svelte";
	import {
		archivableFromItem,
		loadReceivedMedia,
		type ReceivedItem,
		type ReceivedMediaResult,
	} from "$lib/received/received-media";
	import { topChrome } from "$lib/util/screen-chrome.svelte";
	import ReceivedTile from "./ReceivedTile.svelte";

	let { data }: import("./$types").PageProps = $props();

	const conversationId = $derived(page.params.conversationId ?? "");

	let result = $state<ReceivedMediaResult | null>(null);
	let loading = $state(true);
	let loadError = $state(false);
	let archivingAll = $state(false);

	$effect(() => {
		const id = conversationId;
		const ourId = data.ourProfileId;
		loading = true;
		loadError = false;
		result = null;
		let alive = true;
		void loadReceivedMedia({ conversationId: id, ourProfileId: ourId })
			.then((loaded) => {
				if (!alive) return;
				result = loaded;
			})
			.catch((error: unknown) => {
				console.error(error);
				if (alive) loadError = true;
			})
			.finally(() => {
				if (alive) loading = false;
			});
		return () => {
			alive = false;
		};
	});

	const autoSave = $derived(receivedArchive.isAutoSave(conversationId));

	// When auto-save is on for this person, keep a local copy of everything
	// they sent (including album contents) as soon as it's loaded.
	$effect(() => {
		const items = result?.items;
		if (!autoSave || !items || items.length === 0) return;
		untrack(() => {
			void receivedArchive.saveMany(
				items.filter((i) => i.available).map(archivableFromItem),
			);
		});
	});

	async function toggleAutoSave() {
		const next = !autoSave;
		receivedArchive.setAutoSave(conversationId, next);
		if (next && result)
			await receivedArchive.saveMany(
				result.items.filter((i) => i.available).map(archivableFromItem),
			);
	}

	async function archiveAll() {
		if (!result || archivingAll) return;
		archivingAll = true;
		try {
			await receivedArchive.saveMany(
				result.items.filter((i) => i.available).map(archivableFromItem),
			);
		} finally {
			archivingAll = false;
		}
	}

	let viewing = $state<ReceivedItem | null>(null);
	let viewerSrc = $state<string | null>(null);
	$effect(() => {
		const item = viewing;
		if (!item) {
			viewerSrc = null;
			return;
		}
		let alive = true;
		if (receivedArchive.isArchived(item.id)) {
			void receivedArchive.objectUrl(item.id).then((url) => {
				if (alive) viewerSrc = url ?? item.url;
			});
		} else {
			viewerSrc = item.url;
		}
		return () => {
			alive = false;
		};
	});
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
		<div class="size-9 shrink-0 overflow-hidden rounded-full">
			<UserAvatar
				mediaHash={result?.profile?.mediaHash ?? null}
				class="size-full"
				size="md"
			/>
		</div>
		<div class="min-w-0 flex-1">
			<p class="truncate text-sm font-semibold">
				{result?.profile?.name ?? "Perfil"}
			</p>
			{#if result?.profile?.distance != null}
				<p class="text-2xs text-muted-foreground">
					<DistanceFormatted distance={result.profile.distance} />
				</p>
			{/if}
		</div>
	</div>
	<div class="flex flex-wrap items-center gap-2">
		<Button
			variant="secondary"
			size="sm"
			aria-pressed={autoSave}
			class={{
				"bg-primary text-primary-foreground hover:bg-primary/90": autoSave,
			}}
			onclick={() => void toggleAutoSave()}
		>
			{autoSave ? "Guardando ✓" : "Guardar este perfil"}
		</Button>
		<Button
			variant="secondary"
			size="sm"
			disabled={archivingAll || !result || result.items.length === 0}
			onclick={() => void archiveAll()}
		>
			<DownloadSimpleIcon weight="bold" class="size-3.5" />
			{archivingAll ? "Archivando…" : "Archivar todo"}
		</Button>
	</div>
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
			{#if loading}
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
					{#each result.items as item (item.id)}
						<ReceivedTile {item} onOpen={() => (viewing = item)} />
					{/each}
				</div>
			{/if}
		</div>
	</div>
</main>

{#if viewing}
	{@const current = viewing}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/95"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		onclick={() => (viewing = null)}
		onkeydown={(e) => e.key === "Escape" && (viewing = null)}
	>
		<button
			type="button"
			aria-label="Cerrar"
			class="absolute top-4 right-4 z-10 flex size-10 items-center justify-center rounded-full bg-white/15 text-white"
			onclick={() => (viewing = null)}
		>
			<XIcon class="size-6" />
		</button>
		{#if viewerSrc}
			{#if current.kind === "video"}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video
					src={viewerSrc}
					class="max-h-full max-w-full"
					controls
					autoplay
					playsinline
				></video>
			{:else}
				<img
					src={viewerSrc}
					alt=""
					class="max-h-full max-w-full object-contain"
				/>
			{/if}
		{:else}
			<span
				class="size-10 animate-spin rounded-full border-4 border-white/30 border-t-white"
			></span>
		{/if}
	</div>
{/if}
