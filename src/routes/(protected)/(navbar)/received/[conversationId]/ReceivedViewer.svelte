<script lang="ts">
	import { isTauri } from "@tauri-apps/api/core";
	import CaretLeftIcon from "phosphor-svelte/lib/CaretLeftIcon";
	import CaretRightIcon from "phosphor-svelte/lib/CaretRightIcon";
	import DownloadSimpleIcon from "phosphor-svelte/lib/DownloadSimpleIcon";
	import XIcon from "phosphor-svelte/lib/XIcon";

	import { dismissOnBackGesture } from "$lib/platform/back-gesture-event.svelte";
	import { receivedArchive } from "$lib/received/archive.svelte";
	import type { ReceivedItem } from "$lib/received/received-media";
	import { saveItemToDevice } from "$lib/received/save-to-device";

	let {
		items,
		start,
		onClose,
	}: {
		items: ReceivedItem[];
		start: number;
		onClose: () => void;
	} = $props();

	let index = $state(start);
	const current = $derived(items[index]);
	let src = $state<string | null>(null);
	let downloading = $state(false);
	let saveNote = $state<string | null>(null);

	$effect(() => {
		const item = current;
		if (!item) {
			src = null;
			return;
		}
		let alive = true;
		if (receivedArchive.isArchived(item.id)) {
			void receivedArchive.objectUrl(item.id).then((url) => {
				if (alive) src = url ?? item.url;
			});
		} else {
			src = item.url;
		}
		return () => {
			alive = false;
		};
	});

	function go(delta: number) {
		const next = index + delta;
		if (next >= 0 && next < items.length) index = next;
	}

	// Close only the viewer on the Android back gesture, staying in the gallery.
	dismissOnBackGesture({
		active: () => true,
		dismiss: () => onClose(),
		layer: "screen",
	});

	let touchX: number | null = null;
	function onTouchStart(event: TouchEvent) {
		touchX = event.changedTouches[0]?.clientX ?? null;
	}
	function onTouchEnd(event: TouchEvent) {
		if (touchX === null) return;
		const dx = (event.changedTouches[0]?.clientX ?? touchX) - touchX;
		touchX = null;
		if (Math.abs(dx) < 50) return;
		go(dx < 0 ? 1 : -1);
	}

	async function download() {
		const item = current;
		if (!item || downloading) return;
		downloading = true;
		saveNote = null;
		try {
			await saveItemToDevice(item);
			saveNote = isTauri() ? "Guardado en la galería ✓" : "Descargado ✓";
		} catch (error) {
			console.error("[received] download failed", error);
			saveNote = "No se pudo guardar";
		} finally {
			downloading = false;
			window.setTimeout(() => (saveNote = null), 3000);
		}
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === "Escape") onClose();
		else if (e.key === "ArrowRight") go(1);
		else if (e.key === "ArrowLeft") go(-1);
	}}
/>

<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/95"
	role="dialog"
	aria-modal="true"
	ontouchstart={onTouchStart}
	ontouchend={onTouchEnd}
>
	<button
		type="button"
		aria-label="Cerrar"
		class="absolute top-4 left-4 z-10 flex size-10 items-center justify-center rounded-full bg-white/15 text-white"
		onclick={onClose}
	>
		<XIcon class="size-6" />
	</button>
	<button
		type="button"
		aria-label="Descargar"
		class="absolute top-4 right-4 z-10 flex size-10 items-center justify-center rounded-full bg-white/15 text-white disabled:opacity-50"
		disabled={downloading}
		onclick={() => void download()}
	>
		{#if downloading}
			<span
				class="size-5 animate-spin rounded-full border-2 border-white/40 border-t-white"
			></span>
		{:else}
			<DownloadSimpleIcon weight="bold" class="size-6" />
		{/if}
	</button>

	{#if index > 0}
		<button
			type="button"
			aria-label="Anterior"
			class="absolute top-1/2 left-2 z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white"
			onclick={() => go(-1)}
		>
			<CaretLeftIcon class="size-6" />
		</button>
	{/if}
	{#if index < items.length - 1}
		<button
			type="button"
			aria-label="Siguiente"
			class="absolute top-1/2 right-2 z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white"
			onclick={() => go(1)}
		>
			<CaretRightIcon class="size-6" />
		</button>
	{/if}

	{#if current && src}
		{#if current.kind === "video"}
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				src={src}
				class="max-h-full max-w-full"
				controls
				autoplay
				playsinline
			></video>
		{:else}
			<img
				src={src}
				alt=""
				class="max-h-full max-w-full object-contain"
			/>
		{/if}
	{:else}
		<span
			class="size-10 animate-spin rounded-full border-4 border-white/30 border-t-white"
		></span>
	{/if}

	<div
		class="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white"
	>
		{index + 1} / {items.length}
	</div>
	{#if saveNote}
		<div
			class="absolute bottom-16 left-1/2 -translate-x-1/2 rounded-full bg-black/85 px-4 py-1.5 text-sm font-medium text-white"
		>
			{saveNote}
		</div>
	{/if}
</div>
