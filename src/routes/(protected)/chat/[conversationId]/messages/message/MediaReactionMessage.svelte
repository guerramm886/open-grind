<script lang="ts">
	// A reaction or reply to a photo: one from an album (AlbumContentReaction,
	// AlbumContentReply) or a profile photo (ProfilePhotoReply). Shows the
	// photo it was about, small, with the reaction or the reply text.
	import fireEmoji from "$lib/assets/emojis/fire/32px.png";
	import { profileMediaUrl, proxyMediaUrl } from "$lib/util/media";
	import { getMessageContext } from "./context";
	import MessageBubble from "./MessageBubble.svelte";

	let {
		kind,
		previewUrl = null,
		imageHash = null,
		reply = null,
	}: {
		kind: "album-reaction" | "album-reply" | "photo-reply";
		previewUrl?: string | null;
		imageHash?: string | null;
		reply?: string | null;
	} = $props();

	const { isOut } = $derived(getMessageContext()());

	const src = $derived.by(() => {
		if (imageHash) return profileMediaUrl({ mediaHash: imageHash, size: "thumb" });
		if (previewUrl) return proxyMediaUrl(previewUrl);
		return null;
	});
	let failed = $state(false);

	const caption = $derived.by(() => {
		if (kind === "album-reaction")
			return isOut
				? "Reaccionaste a una foto de su álbum"
				: "Reaccionó a una foto de tu álbum";
		if (kind === "album-reply")
			return isOut
				? "Respondiste a una foto de su álbum"
				: "Respondió a una foto de tu álbum";
		return isOut
			? "Respondiste a su foto de perfil"
			: "Respondió a tu foto de perfil";
	});
</script>

<MessageBubble tone="sent">
	<div class="flex items-center gap-2">
		{#if src && !failed}
			<img
				{src}
				alt="Foto"
				class="size-14 shrink-0 rounded-md bg-black/10 object-cover"
				draggable="false"
				onerror={() => (failed = true)}
			/>
		{:else}
			<div
				class="flex size-14 shrink-0 items-center justify-center rounded-md bg-black/10 text-2xs"
			>
				Foto
			</div>
		{/if}
		<div class="min-w-0">
			<p class="text-2xs opacity-70">{caption}</p>
			{#if kind === "album-reaction"}
				<img
					src={fireEmoji}
					alt="Reacción de fuego"
					width="22"
					height="22"
					class="mt-0.5"
					draggable="false"
				/>
			{/if}
			{#if reply}
				<p class="wrap-anywhere whitespace-pre-wrap">{reply}</p>
			{/if}
		</div>
	</div>
</MessageBubble>
