// Automatic copy to the user's own server (the Martins Grindr add-on in Home
// Assistant): every saved photo/video goes to Media › Martins Grindr › persona,
// and the app's settings (phrases, notes, hearts and stars, filters…) are sent
// whenever they change. Runs in the phone app only; the web version already
// lives on that server.

import { invoke, isTauri } from "@tauri-apps/api/core";

import { isWebServer } from "$lib/platform/os";
import { swipeDecisions } from "$lib/grid/swipe-decisions.svelte";
import {
	type ArchivedEntry,
	receivedArchive,
} from "$lib/received/archive.svelte";
import { settingAllowed } from "./backup.svelte";

const CONFIG_KEY = "home-server-v1";
const SENT_KEY = "home-server-settings-sent-v1";
export const DEFAULT_URL = "http://192.168.3.150:8099";
const EVERY_MS = 5 * 60 * 1000;
const FIRST_DELAY_MS = 15 * 1000;
const MAX_FAILURES = 3;

type Config = { url: string; password: string };

function readConfig(): Config {
	try {
		const raw: unknown = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "null");
		if (raw && typeof raw === "object") {
			const { url, password } = raw as Partial<Config>;
			return {
				url: typeof url === "string" ? url : DEFAULT_URL,
				password: typeof password === "string" ? password : "",
			};
		}
	} catch {
		/* start empty */
	}
	return { url: DEFAULT_URL, password: "" };
}

/** Cheap fingerprint, to send the settings only when they changed. */
function fingerprint(text: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return `${text.length}:${hash.toString(16)}`;
}

function settingsSnapshot(): string {
	const settings: Record<string, string> = {};
	for (let index = 0; index < localStorage.length; index += 1) {
		const key = localStorage.key(index);
		if (key === null || !settingAllowed(key)) continue;
		const value = localStorage.getItem(key);
		if (value !== null) settings[key] = value;
	}
	return JSON.stringify(settings);
}

class HomeServer {
	readonly available =
		typeof window !== "undefined" && isTauri() && !isWebServer();
	url = $state(DEFAULT_URL);
	password = $state("");
	running = $state(false);
	/** Files still to send in the current pass. */
	pending = $state(0);
	sentThisPass = $state(0);
	problem = $state<string | null>(null);
	lastOk = $state<number | null>(null);
	#again = false;

	constructor() {
		if (!this.available) return;
		const config = readConfig();
		this.url = config.url;
		this.password = config.password;
		setTimeout(() => void this.sync(), FIRST_DELAY_MS);
		setInterval(() => void this.sync(), EVERY_MS);
	}

	get configured(): boolean {
		return this.available && this.url.trim() !== "" && this.password !== "";
	}

	configure(url: string, password: string): void {
		this.url = url.trim() || DEFAULT_URL;
		this.password = password;
		try {
			localStorage.setItem(
				CONFIG_KEY,
				JSON.stringify({ url: this.url, password: this.password }),
			);
			// A new server gets the settings again.
			localStorage.removeItem(SENT_KEY);
		} catch {
			/* kept for this session */
		}
		this.problem = null;
		void this.sync();
	}

	/** What the server keeps, by entry id. */
	async #serverEntries(url: string, password: string) {
		const text = await invoke<string>("home_server_manifest", { url, password });
		const parsed = JSON.parse(text) as { entries?: unknown };
		const map = new Map<string, ArchivedEntry>();
		if (Array.isArray(parsed.entries))
			for (const raw of parsed.entries) {
				const entry = raw as ArchivedEntry;
				if (
					entry &&
					typeof entry.id === "string" &&
					typeof entry.fileName === "string" &&
					typeof entry.conversationId === "string"
				)
					map.set(entry.id, entry);
			}
		return map;
	}

	async #putItem(url: string, password: string, entry: ArchivedEntry) {
		const { inGallery: _inGallery, ...plain } = entry;
		await invoke("home_server_put_item", {
			url,
			password,
			fileName: entry.fileName,
			entry: JSON.stringify(plain),
			baseName: receivedArchive.galleryBase(entry),
		});
	}

	/** What the server keeps and this phone does not (people crossed out
	 *  here are left out). */
	#missingHere(server: Map<string, ArchivedEntry>): ArchivedEntry[] {
		return [...server.values()]
			.filter(
				(entry) =>
					!receivedArchive.isArchived(entry.id) &&
					!receivedArchive.wasDeletedHere(entry.id) &&
					!(entry.profileId !== null && swipeDecisions.isNope(entry.profileId)),
			)
			.sort((a, b) => a.savedAt - b.savedAt);
	}

	async #getItem(url: string, password: string, entry: ArchivedEntry) {
		const size = await invoke<number>("home_server_get_item", {
			url,
			password,
			fileName: entry.fileName,
		});
		receivedArchive.adoptStored(entry, size);
	}

	// ------------------------------------------------ "Sincronizar todo" button
	/** null = idle; otherwise what the bar shows. */
	syncPhase = $state<null | "comparing" | "up" | "down" | "done">(null);
	upTotal = $state(0);
	upDone = $state(0);
	downTotal = $state(0);
	downDone = $state(0);
	syncFailed = $state(0);
	syncProblem = $state<string | null>(null);
	#cancel = false;

	get syncTotal(): number {
		return this.upTotal + this.downTotal;
	}
	get syncDone(): number {
		return this.upDone + this.downDone;
	}

	cancelFullSync(): void {
		this.#cancel = true;
	}

	/**
	 * Compare what the phone and the server keep and copy each way what is
	 * missing: phone → server, then server → phone. People crossed out on the
	 * phone are not brought back.
	 */
	async fullSync(): Promise<void> {
		if (!this.configured || this.syncPhase === "comparing") return;
		if (this.syncPhase === "up" || this.syncPhase === "down") return;
		// The automatic copy would race us for the same files.
		while (this.running) await new Promise((r) => setTimeout(r, 500));
		this.running = true;
		this.#cancel = false;
		this.syncPhase = "comparing";
		this.upTotal = this.upDone = this.downTotal = this.downDone = 0;
		this.syncFailed = 0;
		this.syncProblem = null;
		const { url, password } = this;
		try {
			await receivedArchive.ready;
			const server = await this.#serverEntries(url, password);
			const phone = receivedArchive.storedEntries();
			const up = phone
				.filter((entry) => !server.has(entry.id))
				.sort((a, b) => a.savedAt - b.savedAt);
			const down = this.#missingHere(server);
			this.upTotal = up.length;
			this.downTotal = down.length;

			this.syncPhase = "up";
			for (const entry of up) {
				if (this.#cancel) break;
				try {
					await this.#putItem(url, password, entry);
				} catch (error) {
					this.syncFailed += 1;
					this.syncProblem = String(error);
					console.error("[home-server] sync up", entry.fileName, error);
				}
				this.upDone += 1;
			}

			this.syncPhase = "down";
			for (const entry of down) {
				if (this.#cancel) break;
				try {
					await this.#getItem(url, password, entry);
				} catch (error) {
					this.syncFailed += 1;
					this.syncProblem = String(error);
					console.error("[home-server] sync down", entry.fileName, error);
				}
				this.downDone += 1;
			}
			this.lastOk = Date.now();
		} catch (error) {
			this.syncProblem = String(error);
		} finally {
			this.syncPhase = "done";
			this.running = false;
		}
	}

	async sync(): Promise<void> {
		if (!this.configured) return;
		if (this.running) {
			this.#again = true;
			return;
		}
		this.running = true;
		this.sentThisPass = 0;
		const { url, password } = this;
		try {
			await receivedArchive.ready;
			const have = await this.#serverEntries(url, password);
			const todo = receivedArchive
				.storedEntries()
				.filter((entry) => !have.has(entry.id))
				// Oldest first, so the folders fill in the order things came.
				.sort((a, b) => a.savedAt - b.savedAt);
			this.pending = todo.length;
			let failures = 0;
			let lastError: unknown = null;
			for (const entry of todo) {
				try {
					await this.#putItem(url, password, entry);
					this.sentThisPass += 1;
				} catch (error) {
					failures += 1;
					lastError = error;
					console.error("[home-server] upload failed", entry.fileName, error);
					if (failures >= MAX_FAILURES) break;
				}
				this.pending -= 1;
			}

			// And the other way: what the server has (from the web version or
			// another phone) and this phone does not.
			if (failures < MAX_FAILURES) {
				const down = this.#missingHere(have);
				this.pending = down.length;
				for (const entry of down) {
					try {
						await this.#getItem(url, password, entry);
					} catch (error) {
						failures += 1;
						lastError = error;
						console.error("[home-server] download failed", entry.fileName, error);
						if (failures >= MAX_FAILURES) break;
					}
					this.pending -= 1;
				}
			}

			const snapshot = settingsSnapshot();
			const mark = fingerprint(snapshot);
			if (localStorage.getItem(SENT_KEY) !== mark) {
				await invoke("home_server_settings", {
					url,
					password,
					settings: snapshot,
				});
				try {
					localStorage.setItem(SENT_KEY, mark);
				} catch {
					/* sent again next time */
				}
			}

			if (lastError !== null) throw lastError;
			this.problem = null;
			this.lastOk = Date.now();
		} catch (error) {
			this.problem = String(error);
		} finally {
			this.running = false;
			this.pending = 0;
			if (this.#again) {
				this.#again = false;
				void this.sync();
			}
		}
	}
}

export const homeServer = new HomeServer();
