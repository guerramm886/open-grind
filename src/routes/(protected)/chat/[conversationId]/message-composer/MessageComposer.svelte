<script lang="ts">
	import { onNavigate } from "$app/navigation";
	import { onDestroy, tick, untrack } from "svelte";

	import { toast } from "svelte-sonner";

	import { showErrorToast } from "$lib/api/error-toast";
	import { getConversations } from "$lib/chat/conversations-context.svelte";
	import { greeting } from "$lib/chat/greeting.svelte";
	import { usedPhrases } from "$lib/chat/used-phrases.svelte";
	import { draftFromMessage } from "$lib/model/messaging/messages";
	import { dismissOnBackGesture } from "$lib/platform/back-gesture-event.svelte";
	import { below } from "$lib/util/breakpoints.svelte";
	import { bottomChrome } from "$lib/util/screen-chrome.svelte";
	import type {
		ApiResponseMessage,
		MessageDraft,
	} from "$lib/model/messaging/messages";
	import { getConversationState } from "../conversation-state.svelte";
	import ComposerAttachmentsTrigger from "./attachments/ComposerAttachmentsTrigger.svelte";
	import {
		type ComposerSheet,
		getComposerSheets,
	} from "./composer-sheets-state.svelte";
	import ComposerReplyPreview from "./ComposerReplyPreview.svelte";
	import ComposerSubmitButton from "./ComposerSubmitButton.svelte";
	import { setMessageComposerContext } from "./message-composer-context.svelte";
	import MessageTextInput from "./MessageTextInput.svelte";
	import ComposerSendMedia from "./send-media/ComposerSendMedia.svelte";
	import GreetingComposerButton from "./GreetingComposerButton.svelte";
	import ComposerVoiceMessage from "./voice-message/ComposerVoiceMessage.svelte";

	let {
		conversationId,
		onSend,
		disabled,
		replyTo,
		onCancelReply,
		height = $bindable(0),
	}: {
		conversationId: string;
		onSend: (drafts: MessageDraft[]) => void | Promise<void>;
		disabled: boolean;
		replyTo?: ApiResponseMessage | null;
		onCancelReply?: () => void;
		height?: number;
	} = $props();

	const { drafts } = getConversations();
	const sheets = getComposerSheets();
	const mobile = below("split");

	let textContent = $state(untrack(() => drafts.get(conversationId)));
	let form: HTMLFormElement | null = $state(null);
	let textInput: HTMLTextAreaElement | null = $state(null);
	let stickersTrigger: HTMLElement | null = $state(null);
	let attachmentsTrigger: HTMLElement | null = $state(null);

	async function onSubmit() {
		const text = textContent.trim();
		if (text === "") return;
		try {
			await onSend([draftFromMessage({ type: "Text", body: { text } })]);
			textContent = "";
			drafts.discard(conversationId);
		} catch (error) {
			console.error(error);
			showErrorToast({ label: "Failed to send message", error });
		}
	}

	// Phrases already sent in this chat: remembered on the device, plus any
	// loaded message of ours with that exact text (e.g. sent before this
	// feature existed, or typed by hand).
	const conversationState = getConversationState();
	const sentTexts = $derived.by(() => {
		const conversation = conversationState();
		const texts = new Set<string>();
		for (const message of conversation.messages) {
			if (message.senderId !== conversation.ourProfileId) continue;
			const text = (message.body as { text?: unknown } | null)?.text;
			if (typeof text === "string") texts.add(text.trim());
		}
		return texts;
	});
	function phraseUsed(phrase: string): boolean {
		// Phrases marked as reusable in the settings are never struck.
		if (greeting.isReusable(phrase)) return false;
		return (
			usedPhrases.has(conversationId, phrase) || sentTexts.has(phrase.trim())
		);
	}

	function tapPhrase(phrase: string) {
		if (!phraseUsed(phrase)) {
			void sendPhrase(phrase);
			return;
		}
		toast("Esa frase ya la mandaste en este chat.", {
			action: {
				label: "Enviar igual",
				onClick: () => void sendPhrase(phrase),
			},
		});
	}

	async function sendPhrase(text: string) {
		if (disabled) return;
		try {
			await onSend([draftFromMessage({ type: "Text", body: { text } })]);
			usedPhrases.mark(conversationId, text);
		} catch (error) {
			console.error(error);
			showErrorToast({ label: "Failed to send message", error });
		}
	}

	function remeasureBeforeResizeObserverCatchesUp() {
		if (form) height = form.clientHeight;
	}

	$effect(() => {
		const openedConversationId = conversationId;
		untrack(() => {
			const stored = drafts.open(openedConversationId);
			if (textContent === stored) return;
			textContent = stored;
			void tick().then(remeasureBeforeResizeObserverCatchesUp);
		});
		return () =>
			drafts.save({
				conversationId: openedConversationId,
				text: textContent,
			});
	});

	$effect(() => {
		drafts.autosave({ conversationId, text: textContent });
	});

	onNavigate(({ to }) => {
		if (to?.params?.conversationId !== conversationId)
			drafts.save({ conversationId, text: textContent });
	});

	// Arming a reply should hand the user straight back to the composer, which
	// on touch is also what raises the keyboard.
	$effect(() => {
		if (!replyTo || !textInput) return;
		if (untrack(() => sheets.hasOpenSheet({ conversationId }))) return;
		textInput.focus();
	});

	dismissOnBackGesture({
		active: () => replyTo !== null && replyTo !== undefined,
		dismiss: () => onCancelReply?.(),
		layer: "screen",
	});

	function focusTrigger({ sheet }: { sheet: ComposerSheet }) {
		const trigger =
			sheet === "attachments" && attachmentsTrigger?.isConnected
				? attachmentsTrigger
				: stickersTrigger;
		trigger?.focus();
	}

	const composerContext = () => ({
		conversationId,
		disabled,
		sendMessages: onSend,
	});
	setMessageComposerContext(composerContext);
	onDestroy(
		sheets.bind({
			conversationState: getConversationState(),
			context: composerContext,
			focusTrigger,
		}),
	);
</script>

<form
	bind:this={form}
	data-slot="message-composer"
	class="absolute bottom-0 z-20 flex min-h-11 w-full min-w-0 shrink-0 flex-col gap-1 px-2 pb-2"
	bind:clientHeight={height}
	{@attach mobile.current && bottomChrome}
	oninput={remeasureBeforeResizeObserverCatchesUp}
	onsubmit={(event) => {
		event.preventDefault();
		onSubmit().catch((error) => console.error(error));
	}}
>
	{#if replyTo}
		<ComposerReplyPreview message={replyTo} onCancel={onCancelReply} />
	{/if}
	{#if greeting.phrases.length > 0 && textContent === ""}
		<div
			class={[
				"flex gap-1.5 pb-1",
				{
					"max-h-24 flex-wrap overflow-y-auto": greeting.phrasesWrap,
					"no-scrollbar overflow-x-auto": !greeting.phrasesWrap,
				},
			]}
		>
			<!-- Always in the configured order: a phrase keeps its place on
			     screen even after it is struck. -->
			{#each greeting.phrases as phrase (phrase)}
				{@const used = phraseUsed(phrase)}
				<button
					type="button"
					{disabled}
					aria-label={used ? `${phrase} (ya enviada)` : phrase}
					class={[
						"rounded-full bg-secondary px-3 py-1 text-sm text-foreground disabled:opacity-50",
						{
							"shrink-0": !greeting.phrasesWrap,
							"line-through opacity-50": used,
						},
					]}
					onclick={() => tapPhrase(phrase)}
				>
					{phrase}
				</button>
			{/each}
		</div>
	{/if}
	<div class="relative h-full w-full rounded-composer bg-popover">
		<GreetingComposerButton bind:ref={stickersTrigger} />
		<MessageTextInput
			bind:value={textContent}
			bind:ref={textInput}
			onEscape={onCancelReply}
		/>
		{#if textContent === ""}
			<ComposerAttachmentsTrigger
				bind:ref={attachmentsTrigger}
				onClick={() =>
					sheets.setOpen({
						conversationId,
						sheet: "attachments",
						open: true,
					})}
			/>
			<ComposerVoiceMessage />
		{:else}
			<ComposerSubmitButton />
		{/if}
	</div>
	{#key conversationId}
		<ComposerSendMedia />
	{/key}
</form>
