// Grindr only says *up to which message* the other person has read, never
// when. So the moment is noted here whenever a read event arrives live, and
// kept so it can still be shown next to that message later.

const KEY = "read-times-v1";
const MAX_ENTRIES = 300;

type Entry = { timestamp: number; at: number };

function load(): Record<string, Entry> {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
		return parsed && typeof parsed === "object"
			? (parsed as Record<string, Entry>)
			: {};
	} catch {
		return {};
	}
}

let entries = $state<Record<string, Entry>>(load());

export const readTimes = {
	/** When we saw the read of the message sent at `timestamp`, if we did. */
	at(conversationId: string, timestamp: number | null): number | null {
		const entry = entries[conversationId];
		return entry && entry.timestamp === timestamp ? entry.at : null;
	},

	note(conversationId: string, timestamp: number): void {
		const next = { ...entries, [conversationId]: { timestamp, at: Date.now() } };
		const ids = Object.keys(next);
		if (ids.length > MAX_ENTRIES) {
			ids.sort((a, b) => (next[a]?.at ?? 0) - (next[b]?.at ?? 0));
			for (const id of ids.slice(0, ids.length - MAX_ENTRIES)) delete next[id];
		}
		entries = next;
		try {
			localStorage.setItem(KEY, JSON.stringify(next));
		} catch {
			// Storage full or unavailable: the time just won't survive a restart.
		}
	},
};
