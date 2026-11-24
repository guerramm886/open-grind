<script lang="ts">
	import { isTauri } from "@tauri-apps/api/core";
	import CaretLeftIcon from "phosphor-svelte/lib/CaretLeftIcon";
	import CaretRightIcon from "phosphor-svelte/lib/CaretRightIcon";
	import DownloadSimpleIcon from "phosphor-svelte/lib/DownloadSimpleIcon";
	import XIcon from "phosphor-svelte/lib/XIcon";

	import { dismissOnBackGesture } from "$lib/platform/back-gesture-event.svelte";
	import { isWebServer } from "$lib/platform/os";
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
		if (next >= 0 && next < items.length) {
			index = next;
			resetZoom();
		}
	}

	// Home Assistant (web on a PC): zoom like a pinch with the mouse wheel,
	// double click or + / - / 0, and drag to move around a zoomed photo.
	const onPc = isWebServer();
	let zoom = $state(1);
	let panX = $state(0);
	let panY = $state(0);
	let panFrom: { x: number; y: number; panX: number; panY: number } | null =
		null;
	let panned = false;
	const zoomed = $derived(zoom > 1.01);

	function resetZoom() {
		zoom = 1;
		panX = 0;
		panY = 0;
	}
	function setZoom(next: number) {
		zoom = Math.min(6, Math.max(1, next));
		if (zoom <= 1.01) resetZoom();
	}
	function onWheel(event: WheelEvent) {
		if (!onPc || current?.kind !== "image") return;
		event.preventDefault();
		setZoom(zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15));
	}
	function onPointerDown(event: PointerEvent) {
		if (!onPc || event.pointerType !== "mouse" || event.button !== 0) return;
		panFrom = { x: event.clientX, y: event.clientY, panX, panY };
		panned = false;
	}
	function onPointerMove(event: PointerEvent) {
		if (!panFrom) return;
		const dx = event.clientX - panFrom.x;
		const dy = event.clientY - panFrom.y;
		if (Math.abs(dx) + Math.abs(dy) > 4) panned = true;
		if (zoomed) {
			panX = panFrom.panX + dx;
			panY = panFrom.panY + dy;
		}
	}
	function onPointerUp(event: PointerEvent) {
		if (!panFrom) return;
		const dx = event.clientX - panFrom.x;
		const dy = event.clientY - panFrom.y;
		panFrom = null;
		// Not zoomed: a sideways drag is a swipe to the next/previous photo.
		if (!zoomed && Math.abs(dx) >= 80 && Math.abs(dx) >= Math.abs(dy) * 1.3) {
			swipedAway = true;
			go(dx < 0 ? 1 : -1);
		}
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
		if (swipedAway || panned) {
			swipedAway = false;
			panned = false;
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
		if (e.key === "Escape") {
			if (zoomed) resetZoom();
			else onClose();
		} else if (e.key === "ArrowRight") go(1);
		else if (e.key === "ArrowLeft") go(-1);
		else if (onPc && (e.key === "+" || e.key === "=")) setZoom(zoom * 1.25);
		else if (onPc && e.key === "-") setZoom(zoom / 1.25);
		else if (onPc && e.key === "0") resetZoom();
	}}
/>

<div
	class={[
		"fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/95",
		{ "cursor-grab": zoomed },
	]}
	role="dialog"
	aria-modal="true"
	tabindex="-1"
	ontouchstart={onTouchStart}
	ontouchend={onTouchEnd}
	onwheel={onWheel}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	ondblclick={() => {
		if (!onPc || current?.kind !== "image") return;
		if (zoomed) resetZoom();
		else setZoom(2.5);
	}}
	ondragstart={(event) => {
		if (onPc) event.preventDefault();
	}}
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

	{#if current && current.kind === "image" && !zoomed}
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
			<img
				{src}
				alt=""
				class="max-h-full max-w-full object-contain select-none"
				draggable="false"
				style:transform={zoomed
					? `translate(${panX}px, ${panY}px) scale(${zoom})`
					: undefined}
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
