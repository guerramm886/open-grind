<script lang="ts">
	// A voice note: play/pause, a seek bar and the time.
	import PauseIcon from "phosphor-svelte/lib/PauseIcon";
	import PlayIcon from "phosphor-svelte/lib/PlayIcon";

	import { proxyMediaUrl } from "$lib/util/media";
	import type { AudioMessage } from "$lib/model/messaging/messages";
	import MessageBubble from "./MessageBubble.svelte";

	let { message }: { message: AudioMessage["body"] } = $props();

	// Recorded here and still sending: the page's own blob, not a CDN url.
	const src = $derived(
		message.url.startsWith("blob:") || message.url.startsWith("data:")
			? message.url
			: proxyMediaUrl(message.url, { as: "video" }),
	);
	const expired = $derived(
		message.expiresAt !== null && message.expiresAt < Date.now(),
	);

	let audio: HTMLAudioElement | null = $state(null);
	let paused = $state(true);
	let current = $state(0);
	let duration = $state(0);
	let failed = $state(false);

	const total = $derived(
		Number.isFinite(duration) && duration > 0
			? duration
			: (message.length ?? 0) / 1000,
	);

	function clock(seconds: number): string {
		const s = Math.max(0, Math.round(seconds));
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
	}

	function toggle() {
		if (!audio) return;
		if (audio.paused) {
			// Only one voice note at a time.
			for (const other of document.querySelectorAll("audio")) {
				if (other !== audio) other.pause();
			}
			audio.play().catch((error: unknown) => {
				console.error(error);
				failed = true;
			});
		} else {
			audio.pause();
		}
	}
</script>

<MessageBubble tone="sent">
	{#if expired}
		<span class="text-sm italic opacity-70">Audio vencido</span>
	{:else}
		<div class="flex w-56 max-w-full items-center gap-2">
			<button
				type="button"
				class="flex size-9 shrink-0 items-center justify-center rounded-full bg-black/80 text-white"
				aria-label={paused ? "Reproducir audio" : "Pausar audio"}
				onclick={toggle}
			>
				{#if paused}
					<PlayIcon size={18} weight="fill" />
				{:else}
					<PauseIcon size={18} weight="fill" />
				{/if}
			</button>
			<div class="flex min-w-0 grow flex-col">
				<input
					type="range"
					min="0"
					max={total || 1}
					step="0.1"
					value={current}
					aria-label="Posición del audio"
					class="w-full accent-black"
					oninput={(event) => {
						if (audio) audio.currentTime = Number(event.currentTarget.value);
					}}
				/>
				<span class="text-2xs opacity-70">
					{#if failed}
						No se pudo reproducir
					{:else}
						{clock(paused && current === 0 ? total : current)}
					{/if}
				</span>
			</div>
		</div>
		<audio
			bind:this={audio}
			{src}
			preload="metadata"
			onplay={() => (paused = false)}
			onpause={() => (paused = true)}
			onended={() => {
				paused = true;
				current = 0;
			}}
			ontimeupdate={(event) => (current = event.currentTarget.currentTime)}
			ondurationchange={(event) => (duration = event.currentTarget.duration)}
			onerror={() => (failed = true)}
		></audio>
	{/if}
</MessageBubble>
