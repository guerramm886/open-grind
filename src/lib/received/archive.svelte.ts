// Persistent local archive for media other people sent you. Media bytes are
// fetched through the native `ogmedia` proxy and stored in the Origin Private
// File System, so a saved copy survives the sender deleting the content,
// unsending it, or deleting their profile. It is only lost if the app is
// uninstalled or its data is cleared. Metadata lives in localStorage.

const MANIFEST_KEY = "received-archive-manifest-v1";
const AUTOSAVE_KEY = "received-autosave-v1";
const ARCHIVE_DIR = "received-archive";

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
	/** Proxied (ogmedia) URL the webview can fetch for the raw bytes. */
	url: string;
};

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
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- blob URL cache, never read from a template
	#urls = new Map<string, string>();
	#supported = $state(true);

	constructor() {
		if (typeof localStorage !== "undefined") {
			this.#entries = readManifest();
			this.#autoSave = readAutoSave();
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
			const response = await fetch(item.url);
			if (!response.ok) throw new Error(`fetch ${response.status}`);
			const blob = await response.blob();
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
