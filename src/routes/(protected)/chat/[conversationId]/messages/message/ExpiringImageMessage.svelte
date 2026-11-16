<script lang="ts">
	import "photoswipe/style.css";
	import ImagesIcon from "phosphor-svelte/lib/ImagesIcon";

	import { showErrorToast } from "$lib/api/error-toast";
	import { getSingleMessage } from "$lib/api/messaging/messages";
	import {
		type ExpiringImageMessage,
		expiringImageMessageSchema,
	} from "$lib/model/messaging/messages";
	import { keepExpiringMedia } from "$lib/received/keep-expiring";
	import { proxyMediaUrl } from "$lib/util/media";
	import {
		measureImage,
		type MediaDimensions,
	} from "$lib/util/media-dimensions";
	import { openLightbox } from "$lib/util/photoswipe";
	import LockedMedia from "./LockedMedia.svelte";
	import { MessageMediaState } from "./message-media.svelte";

	let {
		conversationId,
		messageId,
		message,
		isOut,
		senderId = null,
		sentAt = null,
	}: {
		conversationId: string;
		messageId: string;
		message: ExpiringImageMessage["body"];
		isOut: boolean;
		senderId?: number | null;
		sentAt?: number | null;
	} = $props();

	const media = new MessageMediaState();

	const className: import("svelte/elements").ClassValue = $derived([
		"relative",
		{ "size-full": media.clone },
	]);

	const contentClass: import("svelte/elements").ClassValue = $derived([
		"rounded-xl",
		media.cornerClass,
	]);

	const bubbleClass: import("svelte/elements").ClassValue = $derived([
		"flex w-fit items-center gap-2 px-4 py-3 text-start font-medium",
		className,
		contentClass,
		"border border-border bg-input",
	]);

	type LoadedImage = { url: string; size: MediaDimensions | null };

	type ImageState =
		| { status: "idle" }
		| { status: "loading" }
		| { status: "open"; image: LoadedImage }
		| { status: "expired" };

	let imageState = $state<ImageState>({ status: "idle" });
	let cachedImage: LoadedImage | null = null;

	const ownUrl = $derived(
		isOut && message.url !== null ? proxyMediaUrl(message.url) : null,
	);

	const viewable = $derived.by(() => {
		if (isOut) {
			return ownUrl !== null;
		} else {
			return (
				imageState.status !== "expired" &&
				message.viewed !== true &&
				message.viewsRemaining !== 0
			);
		}
	});

	// On a photo we sent, the server tells whether the other person opened it.
	const seenLabel = $derived.by(() => {
		if (!isOut) return null;
		if (message.viewed === true || message.viewsRemaining === 0)
			return "Vista";
		if (message.viewed === false) return "Sin ver";
		return null;
	});

	function openImage() {
		imageState =
			cachedImage === null
				? { status: "loading" }
				: { status: "open", image: cachedImage };
	}

	async function fetchImageUrl(): Promise<string | null> {
		const { body: image } = await getSingleMessage({
			conversationId,
			messageId,
		}).then((res) => expiringImageMessageSchema.parse(res.message));
		if (image.url === null) return null;
		// Received view-once photo: keep it with the rest of what they sent.
		if (!isOut) {
			keepExpiringMedia({
				conversationId,
				senderId,
				sentAt,
				kind: "image",
				mediaKey: image.mediaId,
				rawUrl: image.url,
			});
		}
		return proxyMediaUrl(image.url);
	}

	$effect(() => {
		if (imageState.status !== "loading") return;
		void (async () => {
			try {
				const url = ownUrl ?? (await fetchImageUrl());
				if (url === null) {
					imageState = { status: "expired" };
					return;
				}
				const size = await measureImage(url).catch(() => null);
				cachedImage = { url, size };
				imageState = { status: "open", image: cachedImage };
			} catch (error) {
				console.error(error);
				showErrorToast({
					label: "Failed to load expiring image",
					error,
				});
				imageState = { status: "idle" };
			}
		})();
	});

	$effect(() => {
		if (imageState.status !== "open") return;
		const { image } = imageState;
		const controller = new AbortController();
		openLightbox({
			items: [
				{
					src: image.url,
					width: image.size?.width ?? 0,
					height: image.size?.height ?? 0,
				},
			],
			signal: controller.signal,
			onClosed: () => {
				imageState = { status: "idle" };
			},
		}).catch((error: unknown) => {
			if (controller.signal.aborted) return;
			console.error(error);
			showErrorToast({ label: "Failed to open expiring image", error });
			imageState = { status: "idle" };
		});
		return () => controller.abort();
	});
</script>

{#snippet bubbleContent()}
	<ImagesIcon size={24} weight="fill" class="shrink-0" />
	<span>Expiring image</span>
	{#if seenLabel}
		<span
			data-slot="expiring-image-seen"
			class={[
				"text-xs font-semibold",
				seenLabel === "Vista" ? "text-primary" : "text-muted-foreground",
			]}
		>
			· {seenLabel}
		</span>
	{/if}
	{@render media.adornments?.()}
{/snippet}

{#if viewable}
	<button
		data-slot="expiring-image-message"
		class={[
			bubbleClass,
			{
				"cursor-pointer": imageState.status === "idle",
				"opacity-50": imageState.status === "loading",
			},
		]}
		onclick={openImage}
		disabled={imageState.status !== "idle"}
		{@attach media.attach}
	>
		{@render bubbleContent()}
	</button>
{:else if isOut}
	<div
		data-slot="expiring-image-message-spent"
		class={[bubbleClass, "text-muted-foreground"]}
		{@attach media.attach}
	>
		{@render bubbleContent()}
	</div>
{:else}
	<div
		data-slot="expiring-image-message-expired"
		class={["w-fit", className, contentClass]}
		{@attach media.attach}
	>
		<LockedMedia
			class={[
				media.cornerClass,
				"gap-2 px-4 py-3 font-medium text-neutral-600",
			]}
			size="sm"
		>
			Expired image
		</LockedMedia>
		{@render media.adornments?.()}
	</div>
{/if}

<style>
	:global(.pswp__img) {
		object-fit: contain;
	}
</style>
