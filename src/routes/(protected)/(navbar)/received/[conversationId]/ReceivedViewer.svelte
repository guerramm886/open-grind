<script lang="ts">
	import { isTauri } from "@tauri-apps/api/core";
	import CaretLeftIcon from "phosphor-svelte/lib/CaretLeftIcon";
	import CaretRightIcon from "phosphor-svelte/lib/CaretRightIcon";
	import DownloadSimpleIcon from "phosphor-svelte/lib/DownloadSimpleIcon";
	import XIcon from "phosphor-svelte/lib/XIcon";

	import { dismissOnBackGesture } from "$lib/platform/back-gesture-event.svelte";
	import { receivedArchive } from "$lib/received/archive.svelte";
	import { saveItemToDevice } from "$lib/received/save-to-device";
	import type { ReceivedItem } from "$lib/received/received-media";

	let {
		items,
		start,
		onClose,
	}: { items: ReceivedItem[]; start: number; onClose: () => void } = $props();

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
	let touchY: number | null = null;
	// Set true when a touch ends as a horizontal swipe, so the edge-tap click
	// that follows (which would change photo) is swallowed instead.
	let swipedAway = false;

	function onTouchStart(event: TouchEvent) {
		const touch = event.changedTouches[0];
		touchX = touch?.clientX ?? null;
		touchY = touch?.clientY ?? null;
		swipedAway = false;
	}
	function onTouchEnd(event: TouchEvent) {
		if (touchX === null || touchY === null) return;
		const touch = event.changedTouches[0];
		const dx = (touch?.clientX ?? touchX) - touchX;
		const dy = (touch?.clientY ?? touchY) - touchY;
		touchX = null;
		touchY = null;
		// A clearly horizontal swipe changes photo (same as tapping an edge);
		// the gesture must be sideways enough not to be a tap or a scroll.
		if (Math.abs(dx) < 55) return;
		if (Math.abs(dx) < Math.abs(dy) * 1.3) return;
		swipedAway = true;
		go(dx < 0 ? 1 : -1);
	}

	// Edge taps change photo too, but after a swipe the browser fires a trailing
	// click on the edge we must ignore once, or the photo would advance twice.
	function onEdgeTap(delta: number) {
		if (swipedAway) {
			swipedAway = false;
			return;
		}
		go(delta);
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
	tabindex="-1"
	ontouchstart={onTouchStart}
	ontouchend={onTouchEnd}
>
	<button
		type="button"
		aria-label="Cerrar"
		class="absolute top-[calc(var(--safe-area-top)+0.75rem)] left-4 z-10 flex size-10 items-center justify-center rounded-full bg-white/15 text-white"
		onclick={onClose}
	>
		<XIcon class="size-6" />
	</button>
	<button
		type="button"
		aria-label="Descargar"
		class="absolute top-[calc(var(--safe-area-top)+0.75rem)] right-4 z-10 flex size-10 items-center justify-center rounded-full bg-white/15 text-white disabled:opacity-50"
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

	{#if current && current.kind === "image"}
		<!-- Tap the left/right half of the screen to change photo. -->
		<button
			type="button"
			aria-label="Foto anterior"
			class="absolute inset-y-0 left-0 z-[5] w-1/2"
			onclick={() => onEdgeTap(-1)}
		></button>
		<button
			type="button"
			aria-label="Foto siguiente"
			class="absolute inset-y-0 right-0 z-[5] w-1/2"
			onclick={() => onEdgeTap(1)}
		></button>
	{/if}

	{#if current && src}
		{#if current.kind === "video"}
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				{src}
				class="max-h-full max-w-full"
				controls
				autoplay
				playsinline
			></video>
		{:else}
			<img {src} alt="" class="max-h-full max-w-full object-contain" />
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
