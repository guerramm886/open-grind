<script lang="ts">
	// Voice notes: tap the microphone to record, then send or discard.
	import MicrophoneIcon from "phosphor-svelte/lib/MicrophoneIcon";
	import PaperPlaneRightIcon from "phosphor-svelte/lib/PaperPlaneRightIcon";
	import TrashIcon from "phosphor-svelte/lib/TrashIcon";
	import { onDestroy } from "svelte";
	import { toast } from "svelte-sonner";

	import { uploadChatAudio } from "$lib/api/messaging/chat-media";
	import type { MessageDraft } from "$lib/model/messaging/messages";
	import { getMessageComposerContext } from "../message-composer-context.svelte";
	import PrimaryComposerButton from "../PrimaryComposerButton.svelte";

	const composer = getMessageComposerContext();
	const { disabled } = $derived(composer());

	/** Grindr's own voice notes stop at a minute. */
	const MAX_MS = 60_000;
	/** AAC in MP4 plays everywhere; WebM/Opus only where nothing else records. */
	const PREFERRED_TYPES = [
		"audio/mp4;codecs=mp4a.40.2",
		"audio/mp4",
		"audio/aac",
		"audio/webm;codecs=opus",
		"audio/webm",
		"audio/ogg;codecs=opus",
	];

	let recorder: MediaRecorder | null = null;
	let stream: MediaStream | null = null;
	let chunks: Blob[] = [];
	let startedAt = 0;
	let ticker: ReturnType<typeof setInterval> | null = null;
	let sendWhenStopped = false;

	let recording = $state(false);
	let starting = $state(false);
	let elapsedMs = $state(0);

	function clock(ms: number): string {
		const s = Math.floor(ms / 1000);
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
	}

	function pickType(): string | undefined {
		if (typeof MediaRecorder === "undefined") return undefined;
		return PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
	}

	function release() {
		if (ticker !== null) clearInterval(ticker);
		ticker = null;
		for (const track of stream?.getTracks() ?? []) track.stop();
		stream = null;
		recorder = null;
		recording = false;
	}

	async function start() {
		if (recording || starting || disabled) return;
		if (!navigator.mediaDevices?.getUserMedia) {
			toast.error(
				window.isSecureContext
					? "Este dispositivo no permite grabar audio"
					: "Para grabar audio la página tiene que abrirse con https",
			);
			return;
		}
		starting = true;
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch (error) {
			console.error(error);
			starting = false;
			toast.error("No hay permiso para usar el micrófono");
			return;
		}
		const mimeType = pickType();
		try {
			recorder = new MediaRecorder(
				stream,
				mimeType ? { mimeType, audioBitsPerSecond: 64_000 } : undefined,
			);
		} catch (error) {
			console.error(error);
			release();
			starting = false;
			toast.error("No se pudo empezar a grabar");
			return;
		}
		chunks = [];
		sendWhenStopped = false;
		recorder.ondataavailable = (event) => {
			if (event.data.size > 0) chunks.push(event.data);
		};
		recorder.onstop = () => {
			const type = recorder?.mimeType || mimeType || "audio/mp4";
			const lengthMs = Date.now() - startedAt;
			const blob = new Blob(chunks, { type });
			chunks = [];
			release();
			if (sendWhenStopped) void send({ blob, type, lengthMs });
		};
		startedAt = Date.now();
		elapsedMs = 0;
		recorder.start(250);
		recording = true;
		starting = false;
		ticker = setInterval(() => {
			elapsedMs = Date.now() - startedAt;
			if (elapsedMs >= MAX_MS) finish(true);
		}, 200);
	}

	function finish(send: boolean) {
		if (!recorder) return;
		sendWhenStopped = send;
		if (recorder.state !== "inactive") recorder.stop();
		else release();
	}

	async function send({
		blob,
		type,
		lengthMs,
	}: {
		blob: Blob;
		type: string;
		lengthMs: number;
	}) {
		if (lengthMs < 700 || blob.size === 0) {
			toast("El audio es muy corto");
			return;
		}
		// Grindr wants the plain type, without the codec.
		const contentType = (type.split(";")[0] ?? "").trim() || "audio/mp4";
		const localUrl = URL.createObjectURL(blob);
		const draft: MessageDraft = {
			outbound: async () => {
				try {
					const uploaded = await uploadChatAudio({
						blob,
						contentType,
						lengthMs,
					});
					return { type: "Audio", body: { mediaId: uploaded.mediaId } };
				} catch (error) {
					console.error(error);
					toast.error("No se pudo subir el audio");
					throw error;
				}
			},
			optimistic: {
				type: "Audio",
				body: {
					mediaId: 0,
					mediaHash: null,
					url: localUrl,
					contentType,
					length: Math.round(lengthMs),
					expiresAt: null,
				},
			},
		};
		try {
			await composer().sendMessages([draft]);
		} catch (error) {
			console.error(error);
		}
	}

	onDestroy(() => finish(false));
</script>

{#if recording}
	<div
		class="absolute inset-0 z-10 flex items-center gap-2 rounded-composer bg-popover ps-2 pe-1"
		role="group"
		aria-label="Grabando audio"
	>
		<button
			type="button"
			class="flex size-9 shrink-0 items-center justify-center rounded-full text-destructive"
			aria-label="Descartar audio"
			onclick={() => finish(false)}
		>
			<TrashIcon size={20} weight="fill" />
		</button>
		<span class="size-2.5 shrink-0 animate-pulse rounded-full bg-red-500"></span>
		<span class="grow text-sm tabular-nums">
			Grabando {clock(elapsedMs)}
			<span class="text-2xs text-muted-foreground">/ {clock(MAX_MS)}</span>
		</span>
		<button
			type="button"
			class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
			aria-label="Enviar audio"
			onclick={() => finish(true)}
		>
			<PaperPlaneRightIcon size={18} weight="fill" />
		</button>
	</div>
{:else}
	<PrimaryComposerButton
		aria-label="Grabar audio"
		onclick={() => void start()}
		class={["ps-0", { "opacity-50": starting }]}
		disabled={disabled || starting}
	>
		{#snippet icon({ ...props })}
			<MicrophoneIcon weight="fill" {...props} />
		{/snippet}
	</PrimaryComposerButton>
{/if}
