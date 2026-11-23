// Automatic copy to the user's own server (the Martins Grindr add-on in Home
// Assistant): every saved photo/video goes to Media › Martins Grindr › persona,
// and the app's settings (phrases, notes, hearts and stars, filters…) are sent
// whenever they change. Runs in the phone app only; the web version already
// lives on that server.

import { invoke, isTauri } from "@tauri-apps/api/core";

import { isWebServer } from "$lib/platform/os";
import { receivedArchive } from "$lib/received/archive.svelte";
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
			const have = new Set(
				await invoke<string[]>("home_server_list", { url, password }),
			);
			const todo = receivedArchive.all
				.filter((entry) => receivedArchive.isStored(entry))
				.filter((entry) => !have.has(entry.fileName))
				// Oldest first, so the folders fill in the order things came.
				.reverse();
			this.pending = todo.length;
			let failures = 0;
			let lastError: unknown = null;
			for (const entry of todo) {
				try {
					await invoke("home_server_upload", {
						url,
						password,
						fileName: entry.fileName,
						baseName: receivedArchive.galleryBase(entry),
						isVideo: entry.kind === "video",
						contentType: entry.contentType || null,
					});
					this.sentThisPass += 1;
				} catch (error) {
					failures += 1;
					lastError = error;
					console.error("[home-server] upload failed", entry.fileName, error);
					if (failures >= MAX_FAILURES) break;
				}
				this.pending -= 1;
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
