// Shares a loaded person's received media between the grid (which detects
// senders) and the gallery (which shows and archives them), so the messages
// are not fetched twice.

import type { ReceivedMediaResult } from "$lib/received/received-media";

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain cross-route cache, never read from a template
const cache = new Map<string, ReceivedMediaResult>();

export function getCachedReceived(
	conversationId: string,
): ReceivedMediaResult | undefined {
	return cache.get(conversationId);
}

export function setCachedReceived(
	conversationId: string,
	result: ReceivedMediaResult,
): void {
	cache.set(conversationId, result);
}
