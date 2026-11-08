// Private, on-device notes you can jot on any profile. Never leaves the phone.

const KEY = "profile-notes-v1";

function load(): Record<number, string> {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		return typeof parsed === "object" && parsed !== null
			? (parsed as Record<number, string>)
			: {};
	} catch {
		return {};
	}
}

class ProfileNotes {
	#notes = $state<Record<number, string>>(load());

	get(profileId: number): string {
		return this.#notes[profileId] ?? "";
	}

	has(profileId: number): boolean {
		return (this.#notes[profileId] ?? "").trim() !== "";
	}

	set(profileId: number, note: string): void {
		this.#notes = { ...this.#notes, [profileId]: note };
		try {
			localStorage.setItem(KEY, JSON.stringify(this.#notes));
		} catch (error) {
			console.error(error);
		}
	}
}

export const profileNotes = new ProfileNotes();
