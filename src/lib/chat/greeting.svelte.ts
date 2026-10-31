// A one-tap greeting message, configured once and kept on this device.

const STORAGE_KEY = "greeting-message-v1";

class Greeting {
	message = $state(load());

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
}

function load(): string {
	try {
		return localStorage.getItem(STORAGE_KEY) ?? "";
	} catch {
		return "";
	}
}

export const greeting = new Greeting();
