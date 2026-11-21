<script lang="ts">
	import { promptCopyError } from "$lib/api/error-copy";
	import { showErrorToast } from "$lib/api/error-toast";
	import { tieredFeature } from "$lib/api/error-urn";
	import {
		deleteMessageForMe,
		unsendMessage,
	} from "$lib/api/messaging/messages";
	import { readTimes } from "$lib/chat/read-times.svelte";
	import ReportSheet from "$lib/components/report/ReportSheet.svelte";
	import {
		offerEntitlementBypass,
		reportRefusedDespiteBypass,
	} from "$lib/entitlements/bypass.svelte";
	import {
		type ConversationState,
		getConversationState,
		type OptimisticMessage,
	} from "../conversation-state.svelte";
	import { processMessages } from "../messages";
	import { setMediaRenewal } from "./message/media-renewal";
	import Message from "./message/Message.svelte";
	import { attachGalleryLightbox } from "./message/message-lightbox";

	let { seenMessageIds }: { seenMessageIds: Set<string> } = $props();

	// One lightbox for every photo in the conversation, so opening a photo lets
	// you swipe (or use the side arrows) to the next/previous one. The wrapper
	// is display:contents, so it groups the anchors without affecting layout.
	let photosEl = $state<HTMLElement | null>(null);
	$effect(() => {
		const gallery = photosEl;
		if (!gallery) return;
		return attachGalleryLightbox({
			gallery,
			childrenSelector: 'a[data-lightbox-group="chat-photos"]',
		});
	});

	let reportOpen = $state(false);
	let reportProfileId = $state<number | null>(null);

	const conversationState = $derived(getConversationState()());

	// The list is keyed by message id; if a message ever shows up twice (the
	// sent copy and the live event racing), render it once instead of letting
	// the whole chat fail with "each_key_duplicate".
	const shownMessages = $derived.by(() => {
		const seen = new Set<string>();
		return conversationState.messages.toReversed().filter((message) => {
			if (seen.has(message.messageId)) return false;
			seen.add(message.messageId);
			return true;
		});
	});
	setMediaRenewal(() => conversationState.dynamicRefresh.renewMedia());

	// Grindr reports one read position per chat. "Visto" goes on the newest
	// of our messages at or before it, "Enviado" on our newest one after it.
	const readMarks = $derived.by(() => {
		const lastRead = conversationState.lastReadTimestamp;
		let newestSent: string | null = null;
		let newestRead: string | null = null;
		for (const message of conversationState.messages) {
			if (message.senderId !== conversationState.ourProfileId) continue;
			if (message.status !== "sent") continue;
			newestSent ??= message.messageId;
			if (lastRead !== null && message.timestamp <= lastRead) {
				newestRead = message.messageId;
				break;
			}
		}
		return {
			read: newestRead,
			sent: newestSent === newestRead ? null : newestSent,
			readAt: readTimes.at(conversationState.conversationId, lastRead),
		};
	});

	const layoutByMessageId = $derived(
		new Map(
			processMessages({
				messages: conversationState.messages,
				ourProfileId: conversationState.ourProfileId,
			}).map((layout) => [layout.messageId, layout] as const),
		),
	);

	async function unsend({
		state,
		messageId,
	}: {
		state: ConversationState;
		messageId: string;
	}) {
		const { revert } = state.markMessageAsUnsent(messageId);
		try {
			await unsendMessage({
				conversationId: state.conversationId,
				messageId,
			});
		} catch (error) {
			revert();
			throw error;
		}
	}

	async function requestUnsend(messageId: string) {
		const state = conversationState;
		try {
			await unsend({ state, messageId });
		} catch (error) {
			console.error(error);
			if (tieredFeature(error) === "UnsentMessage") {
				const lease = await offerEntitlementBypass({
					reason: "Unsending a message requires a Grindr subscription.",
				});
				if (lease === null) return;
				await unsend({ state, messageId })
					.catch(reportRefusedDespiteBypass)
					.finally(lease.release);
				return;
			}
			showErrorToast({ label: "Failed to unsend message", error });
		}
	}

	async function deleteForMe(message: OptimisticMessage) {
		const state = conversationState;
		const { revert } = state.remove(message.messageId);
		if (message.status === "error") return;
		try {
			await deleteMessageForMe({
				conversationId: state.conversationId,
				messageId: message.messageId,
			});
		} catch (error) {
			console.error(error);
			showErrorToast({ label: "Failed to delete message", error });
			revert();
		}
	}
</script>

<div class="contents" bind:this={photosEl}>
	{#each shownMessages as message (message.messageId)}
		{@const isOut = message.senderId === conversationState.ourProfileId}
	{@const delivered = message.status === "sent"}
	{@const layout = layoutByMessageId.get(message.messageId)}
	{@const indexInStack = layout?.indexInStack ?? 0}
	{@const stackLength = layout?.stackLength ?? 1}
	{@const dayStart = layout?.dayStart}
	{@const isRead =
		message.messageId === readMarks.read
			? true
			: message.messageId === readMarks.sent
				? false
				: null}
	<Message
		{message}
		{isOut}
		{indexInStack}
		{stackLength}
		{dayStart}
		status={message.status}
		{isRead}
		readAt={isRead === true ? readMarks.readAt : null}
		onVisible={!isOut
			? () => {
					seenMessageIds.add(message.messageId);
					conversationState.reportRead(message);
				}
			: undefined}
		onDelete={message.status === "pending"
			? undefined
			: () => deleteForMe(message)}
		onReply={delivered && !message.unsent
			? () => conversationState.setReplyTo(message)
			: undefined}
		onReport={!isOut && conversationState.profile
			? () => {
					reportProfileId =
						conversationState.profile?.profileId ?? null;
					reportOpen = reportProfileId !== null;
				}
			: undefined}
		onReact={async (reactionType: number) => {
			try {
				await conversationState.reactTo({
					messageId: message.messageId,
					reactionType,
				});
			} catch (error) {
				console.error(error);
				showErrorToast({ label: "Failed to react to message", error });
			}
		}}
		onUnsend={isOut && delivered && !message.unsent
			? () => void requestUnsend(message.messageId)
			: undefined}
		onCopyError={message.status === "error"
			? () => void promptCopyError(message.sendError).catch(() => {})
			: undefined}
	/>
	{/each}
</div>

{#if reportProfileId !== null}
	<ReportSheet
		bind:open={reportOpen}
		profileId={reportProfileId}
		subject="message"
		locations={["CHAT_MESSAGE"]}
	/>
{/if}
