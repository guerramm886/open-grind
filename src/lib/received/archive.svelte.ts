// Persistent local archive for media other people sent you. Bytes are fetched
// natively (the webview can't fetch the proxied media: http scheme vs the https
// app = mixed content) and stored in the Origin Private File System, so a saved
// copy survives the sender deleting the content, unsending it, deleting their
// profile, or Grindr locking an album. It is only lost if the app is
// uninstalled or its data is cleared. Metadata lives in localStorage.

import { invoke, isTauri } from "@tauri-apps/api/core";

const MANIFEST_KEY = "received-archive-manifest-v1";
const AUTOSAVE_KEY = "received-autosave-v1";
const PEOPLE_KEY = "received-people-v1";
const ARCHIVE_DIR = "received-archive";

export type ArchivedPerson = {
	conversationId: string;
	name: string | null;
	mediaHash: string | null;
};

export type ArchivedKind = "image" | "video";

export type ArchivedEntry = {
	id: string;
	conversationId: string;
	profileId: number | null;
	kind: ArchivedKind;
	contentType: string;
	name: string | null;
	albumId: number | null;
	savedAt: number;
	fileName: string;
};

export type ArchivableItem = {
	id: string;
	conversationId: string;
	profileId: number | null;
	kind: ArchivedKind;
	contentType: string;
	name: string | null;
	albumId: number | null;
	/** Proxied (ogmedia) URL — used only for the web fallback. */
	url: string;
	/** Raw https URL, passed to the native command that fetches the bytes. */
	rawUrl: string;
};

function base64ToArrayBuffer(b64: string): ArrayBuffer {
	const binary = atob(b64);
	const buffer = new ArrayBuffer(binary.length);
	const bytes = new Uint8Array(buffer);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return buffer;
}

async function fetchArchiveBlob(item: ArchivableItem): Promise<Blob> {
	const type =
		item.contentType ||
		(item.kind === "video" ? "video/mp4" : "image/jpeg");
	if (isTauri()) {
		const b64 = await invoke<string>("fetch_media_b64", {
			url: item.rawUrl,
			isVideo: item.kind === "video",
		});
		return new Blob([base64ToArrayBuffer(b64)], { type });
	}
	const response = await fetch(item.url);
	if (!response.ok) throw new Error(`fetch ${response.status}`);
	return response.blob();
}

function readManifest(): Record<string, ArchivedEntry> {
	try {
		const raw = localStorage.getItem(MANIFEST_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		return typeof parsed === "object" && parsed !== null
			? (parsed as Record<string, ArchivedEntry>)
			: {};
	} catch {
		return {};
	}
}

function readAutoSave(): Record<string, true> {
	try {
		const raw = localStorage.getItem(AUTOSAVE_KEY);
		if (!raw) return {};
		const list: unknown = JSON.parse(raw);
		if (!Array.isArray(list)) return {};
		const out: Record<string, true> = {};
		for (const id of list) if (typeof id === "string") out[id] = true;
		return out;
	} catch {
		return {};
	}
}

function readPeople(): Record<
	string,
	{ name: string | null; mediaHash: string | null }
> {
	try {
		const raw = localStorage.getItem(PEOPLE_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		return typeof parsed === "object" && parsed !== null
			? (parsed as Record<
					string,
					{ name: string | null; mediaHash: string | null }
				>)
			: {};
	} catch {
		return {};
	}
}

function fileNameFor(id: string): string {
	return id.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function archiveDir(
	create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
	try {
		const storage = navigator.storage as StorageManager & {
			getDirectory?: () => Promise<FileSystemDirectoryHandle>;
		};
		if (typeof storage?.getDirectory !== "function") return null;
		const root = await storage.getDirectory();
		return await root.getDirectoryHandle(ARCHIVE_DIR, { create });
	} catch {
		return null;
	}
}

class ReceivedArchive {
	#entries = $state<Record<string, ArchivedEntry>>({});
	#autoSave = $state<Record<string, true>>({});
	#saving = $state<Record<string, true>>({});

	#urls = new Map<string, string>();
	#supported = $state(true);

	#people = $state<
		Record<string, { name: string | null; mediaHash: string | null }>
	>({});

	constructor() {
		if (typeof localStorage !== "undefined") {
			this.#entries = readManifest();
			this.#autoSave = readAutoSave();
			this.#people = readPeople();
		}
		this.#supported =
			typeof navigator !== "undefined" &&
			typeof (navigator.storage as { getDirectory?: unknown } | undefined)
				?.getDirectory === "function";
		void this.#requestPersistence();
	}

	get supported(): boolean {
		return this.#supported;
	}

	async #requestPersistence(): Promise<void> {
		try {
			await navigator.storage?.persist?.();
		} catch {
			/* best effort */
		}
	}

	#persistManifest(): void {
		try {
			localStorage.setItem(MANIFEST_KEY, JSON.stringify(this.#entries));
		} catch {
			/* storage full or unavailable */
		}
	}

	#persistAutoSave(): void {
		try {
			localStorage.setItem(
				AUTOSAVE_KEY,
				JSON.stringify(Object.keys(this.#autoSave)),
			);
		} catch {
			/* ignore */
		}
	}

	isArchived(id: string): boolean {
		return this.#entries[id] !== undefined;
	}

	isSaving(id: string): boolean {
		return this.#saving[id] === true;
	}

	entry(id: string): ArchivedEntry | undefined {
		return this.#entries[id];
	}

	entriesFor(conversationId: string): ArchivedEntry[] {
		return Object.values(this.#entries)
			.filter((entry) => entry.conversationId === conversationId)
			.sort((a, b) => b.savedAt - a.savedAt);
	}

	archivedCount(conversationId: string): number {
		return this.entriesFor(conversationId).length;
	}

	/** Every archived item, newest first. */
	get all(): ArchivedEntry[] {
		return Object.values(this.#entries).sort(
			(a, b) => b.savedAt - a.savedAt,
		);
	}

	/** People who have archived media, newest-saved first, with their details. */
	savedPeople(): (ArchivedPerson & { count: number; lastSavedAt: number })[] {
		const byConv: Record<string, { count: number; lastSavedAt: number }> =
			{};
		for (const entry of Object.values(this.#entries)) {
			const prev = byConv[entry.conversationId];
			byConv[entry.conversationId] = {
				count: (prev?.count ?? 0) + 1,
				lastSavedAt: Math.max(prev?.lastSavedAt ?? 0, entry.savedAt),
			};
		}
		return Object.entries(byConv)
			.map(([conversationId, stats]) => ({
				conversationId,
				name: this.#people[conversationId]?.name ?? null,
				mediaHash: this.#people[conversationId]?.mediaHash ?? null,
				...stats,
			}))
			.sort((a, b) => b.lastSavedAt - a.lastSavedAt);
	}

	notePerson(
		conversationId: string,
		person: { name: string | null; mediaHash: string | null },
	): void {
		const prev = this.#people[conversationId];
		if (
			prev &&
			prev.name === person.name &&
			prev.mediaHash === person.mediaHash
		)
			return;
		this.#people = { ...this.#people, [conversationId]: person };
		try {
			localStorage.setItem(PEOPLE_KEY, JSON.stringify(this.#people));
		} catch {
			/* storage unavailable */
		}
	}

	isAutoSave(conversationId: string): boolean {
		return this.#autoSave[conversationId] === true;
	}

	setAutoSave(conversationId: string, on: boolean): void {
		if (on) this.#autoSave = { ...this.#autoSave, [conversationId]: true };
		else {
			const next = { ...this.#autoSave };
			delete next[conversationId];
			this.#autoSave = next;
		}
		this.#persistAutoSave();
	}

	async save(item: ArchivableItem): Promise<boolean> {
		if (this.isArchived(item.id) || this.#saving[item.id]) return true;
		if (!this.#supported) return false;
		this.#saving = { ...this.#saving, [item.id]: true };
		try {
			const blob = await fetchArchiveBlob(item);
			const dir = await archiveDir(true);
			if (!dir) {
				this.#supported = false;
				return false;
			}
			const fileName = fileNameFor(item.id);
			const handle = await dir.getFileHandle(fileName, { create: true });
			const writable = await handle.createWritable();
			await writable.write(blob);
			await writable.close();
			const entry: ArchivedEntry = {
				id: item.id,
				conversationId: item.conversationId,
				profileId: item.profileId,
				kind: item.kind,
				contentType: item.contentType || blob.type,
				name: item.name,
				albumId: item.albumId,
				savedAt: Date.now(),
				fileName,
			};
			this.#entries = { ...this.#entries, [item.id]: entry };
			this.#persistManifest();
			return true;
		} catch (error) {
			console.error("[received-archive] save failed", error);
			return false;
		} finally {
			const next = { ...this.#saving };
			delete next[item.id];
			this.#saving = next;
		}
	}

	async saveMany(items: ArchivableItem[]): Promise<number> {
		let saved = 0;
		for (const item of items) {
			if (this.isArchived(item.id)) continue;
			if (await this.save(item)) saved += 1;
		}
		return saved;
	}

	async remove(id: string): Promise<void> {
		const entry = this.#entries[id];
		if (!entry) return;
		try {
			const dir = await archiveDir(false);
			await dir?.removeEntry(entry.fileName);
		} catch {
			/* file may already be gone */
		}
		const cachedUrl = this.#urls.get(id);
		if (cachedUrl) {
			URL.revokeObjectURL(cachedUrl);
			this.#urls.delete(id);
		}
		const next = { ...this.#entries };
		delete next[id];
		this.#entries = next;
		this.#persistManifest();
	}

	/**
	 * Forget everything stored for a person: delete every archived file, its
	 * manifest entries, and the saved person record. Used when you cross them
	 * out, so nothing of theirs is kept.
	 */
	async forget(conversationId: string): Promise<void> {
		const ids = Object.values(this.#entries)
			.filter((entry) => entry.conversationId === conversationId)
			.map((entry) => entry.id);
		for (const id of ids) await this.remove(id);
		if (this.#people[conversationId]) {
			const next = { ...this.#people };
			delete next[conversationId];
			this.#people = next;
			try {
				localStorage.setItem(PEOPLE_KEY, JSON.stringify(this.#people));
			} catch {
				/* storage unavailable */
			}
		}
	}

	/** Object URL for the locally stored copy, or null if it cannot be read. */
	async objectUrl(id: string): Promise<string | null> {
		const cached = this.#urls.get(id);
		if (cached) return cached;
		const entry = this.#entries[id];
		if (!entry) return null;
		try {
			const dir = await archiveDir(false);
			if (!dir) return null;
			const handle = await dir.getFileHandle(entry.fileName);
			const file = await handle.getFile();
			const url = URL.createObjectURL(file);
			this.#urls.set(id, url);
			return url;
		} catch {
			return null;
		}
	}
}

export const receivedArchive = new ReceivedArchive();
