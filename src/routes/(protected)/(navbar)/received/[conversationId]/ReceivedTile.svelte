<script lang="ts">
	import BookmarkSimpleIcon from "phosphor-svelte/lib/BookmarkSimpleIcon";
	import CheckCircleIcon from "phosphor-svelte/lib/CheckCircleIcon";
	import PlayCircleIcon from "phosphor-svelte/lib/PlayCircleIcon";

	import { receivedArchive } from "$lib/received/archive.svelte";
	import {
		archivableFromItem,
		type ReceivedItem,
	} from "$lib/received/received-media";

	let { item, onOpen }: { item: ReceivedItem; onOpen: () => void } = $props();

	const archived = $derived(receivedArchive.isArchived(item.id));
	const saving = $derived(receivedArchive.isSaving(item.id));

	// Prefer the locally saved copy so the tile keeps working even if the
	// sender later deleted the original.
	let localSrc = $state<string | null>(null);
	$effect(() => {
		if (!archived) {
			localSrc = null;
			return;
		}
		let alive = true;
		void receivedArchive.objectUrl(item.id).then((url) => {
			if (alive) localSrc = url;
		});
		return () => {
			alive = false;
		};
	});

	// Full-resolution source so thumbnails look sharp (the album thumbUrl is a
	// tiny, blurry preview); the saved copy is preferred when archived.
	const src = $derived(localSrc ?? item.url);

	async function toggleArchive() {
		if (archived) await receivedArchive.remove(item.id);
		else await receivedArchive.save(archivableFromItem(item));
	}
</script>

<div class="relative aspect-square overflow-hidden bg-neutral-800">
	<button
		type="button"
		class="absolute inset-0 size-full"
		aria-label="Ver"
		onclick={onOpen}
	>
		{#if item.kind === "video"}
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				{src}
				class="size-full object-cover"
				muted
				playsinline
				preload="metadata"
			></video>
			<PlayCircleIcon
				weight="fill"
				class="absolute inset-0 m-auto size-10 text-white/90 drop-shadow"
			/>
		{:else}
			<img {src} alt="" class="size-full object-cover" loading="lazy" />
		{/if}
	</button>

	<button
		type="button"
		aria-label={archived ? "Quitar de guardados" : "Guardar"}
		class="absolute top-1 right-1 flex size-7 items-center justify-center rounded-full bg-black/60 text-white"
		onclick={() => void toggleArchive()}
	>
		{#if saving}
			<span
				class="size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
			></span>
		{:else if archived}
			<CheckCircleIcon weight="fill" class="size-5 text-green-400" />
		{:else}
			<BookmarkSimpleIcon weight="regular" class="size-4" />
		{/if}
	</button>
</div>
