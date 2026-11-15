// Which frequent phrases were already sent in each chat, kept on this device so
// they can be shown struck through even when the old messages aren't loaded.

const STORAGE_KEY = "used-phrases-v1";
// Chats remembered; the oldest ones are dropped past this.
const MAX_CHATS = 400;

type Store = Record<string, string[]>;

function load(): Store {
	try {
		const parsed: unknown = JSON.parse(
			localStorage.getItem(STORAGE_KEY) ?? "{}",
		);
		return parsed && typeof parsed === "object" ? (parsed as Store) : {};
	} catch {
		return {};
	}
}

class UsedPhrases {
	#byChat = $state.raw<Store>(load());

	has(conversationId: string, phrase: string): boolean {
		return this.#byChat[conversationId]?.includes(phrase) ?? false;
	}

	mark(conversationId: string, phrase: string): void {
		if (this.has(conversationId, phrase)) return;
		const rest = Object.entries(this.#byChat).filter(
			([id]) => id !== conversationId,
		);
		// Re-inserting moves this chat to the end, so trimming drops the ones
		// touched longest ago.
		this.#byChat = Object.fromEntries([
			...rest.slice(-(MAX_CHATS - 1)),
			[
				conversationId,
				[...(this.#byChat[conversationId] ?? []), phrase],
			],
		]);
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#byChat));
		} catch {
			/* storage unavailable */
		}
	}
}

export const usedPhrases = new UsedPhrases();
