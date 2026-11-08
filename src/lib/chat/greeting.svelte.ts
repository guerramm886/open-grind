// A one-tap greeting message plus a set of frequent phrases, configured once
// and kept on this device.

const STORAGE_KEY = "greeting-message-v1";
const PHRASES_KEY = "greeting-phrases-v1";
const ALBUM_KEY = "greeting-album-v1";

class Greeting {
	message = $state(load());
	phrases = $state<string[]>(loadPhrases());
	/** An album of yours to auto-share with the greeting, or null for none. */
	albumId = $state<number | null>(loadAlbumId());

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

	saveAlbum(albumId: number | null): void {
		this.albumId = albumId;
		try {
			localStorage.setItem(ALBUM_KEY, JSON.stringify(albumId));
		} catch (error) {
			console.error(error);
		}
	}
}

function loadAlbumId(): number | null {
	try {
		const raw = localStorage.getItem(ALBUM_KEY);
		if (!raw) return null;
		const value: unknown = JSON.parse(raw);
		return typeof value === "number" ? value : null;
	} catch {
		return null;
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
