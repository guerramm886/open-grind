// A one-tap greeting message plus a set of frequent phrases, configured once
// and kept on this device.

const STORAGE_KEY = "greeting-message-v1";
const PHRASES_KEY = "greeting-phrases-v1";

class Greeting {
	message = $state(load());
	phrases = $state<string[]>(loadPhrases());

	get configured(): boolean {
		return this.message.trim() !== "";
	}

	save(message: string): void {
		this.message = message;
		try {
			localStorage.setItem(STORAGE_KEY, message);
		} catch (error) {
			console.error(error);
		}
	}

	savePhrases(phrases: string[]): void {
		this.phrases = phrases
			.map((phrase) => phrase.trim())
			.filter((phrase) => phrase !== "");
		try {
			localStorage.setItem(PHRASES_KEY, JSON.stringify(this.phrases));
		} catch (error) {
			console.error(error);
		}
	}
}

function load(): string {
	try {
		return localStorage.getItem(STORAGE_KEY) ?? "";
	} catch {
		return "";
	}
}

function loadPhrases(): string[] {
	try {
		const raw = localStorage.getItem(PHRASES_KEY);
		if (!raw) return [];
		const list: unknown = JSON.parse(raw);
		return Array.isArray(list)
			? list.filter((item): item is string => typeof item === "string")
			: [];
	} catch {
		return [];
	}
}

export const greeting = new Greeting();
