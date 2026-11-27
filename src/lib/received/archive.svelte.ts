// Persistent local archive for media other people sent you, so a saved copy
// survives the sender deleting the content, unsending it, deleting their
// profile, or Grindr locking an album. Metadata lives in localStorage.
//
// In the app, the bytes live in a folder of the app's own data directory
// (see src-tauri/src/archive_store.rs), fetched there natively. They used to
// live in the webview's Origin Private File System, which Android may clear
// to free space; at startup anything still there is moved over, and entries
// whose file is gone are dropped from the list so they can be fetched again
// or restored from a backup. The browser build keeps using OPFS.

import { invoke, isTauri } from "@tauri-apps/api/core";

import type { ByteSource } from "$lib/backup/zip";
import { isWebServer } from "$lib/platform/os";
import { fromBase64, toBase64 } from "$lib/util/base64";

export const MANIFEST_KEY ="received-archive-manifest-v1";
const AUTOSAVE_KEY = "received-autosave-v1";
const PEOPLE_KEY = "received-people-v1";
const ARCHIVE_DIR = "received-archive";
const GALLERY_VISIBLE_KEY = "gallery-visible-v1";
/** Ids already copied to the gallery. Kept apart from the manifest so the
 *  copying doesn't rewrite (and re-render) the whole list once per file. */
const GALLERY_DONE_KEY = "received-gallery-done-v1";
/** Ids deleted on purpose on this device (not brought back by a sync). */
const DELETED_KEY = "received-deleted-here-v1";
const READ_CHUNK = 4 * 1024 * 1024;
const STAGE_CHUNK = 3 * 1024 * 1024;

/** A file in the native store, read in pieces on demand. */
class StoredSource implements ByteSource {
	readonly #fileName: string;
	readonly #start: number;
	readonly size: number;

	constructor(fileName: string, start: number, size: number) {
		this.#fileName = fileName;
		this.#start = start;
		this.size = size;
	}

	slice(start = 0, end = this.size): ByteSource {
		const from = Math.min(Math.max(start, 0), this.size);
		const to = Math.min(Math.max(end, from), this.size);
		return new StoredSource(this.#fileName, this.#start + from, to - from);
	}

	async arrayBuffer(): Promise<ArrayBuffer> {
		const out = new Uint8Array(this.size);
		let filled = 0;
		while (filled < this.size) {
			const chunk = fromBase64(
				await invoke<string>("archive_store_read", {
					fileName: this.#fileName,
					offset: this.#start + filled,
					length: Math.min(READ_CHUNK, this.size - filled),
				}),
			);
			if (chunk.length === 0) break;
			out.set(chunk, filled);
			filled += chunk.length;
		}
		return out.buffer;
	}
}

/** Copy bytes into a native staged file; returns its id. */
async function stageBytes(source: ByteSource): Promise<string> {
	const id = String(await invoke("stage_media"));
	try {
		for (let at = 0; at < source.size; at += STAGE_CHUNK) {
			const bytes = new Uint8Array(
				await source.slice(at, at + STAGE_CHUNK).arrayBuffer(),
			);
			await invoke("append_staged_media", { id, chunk: toBase64(bytes) });
		}
		return id;
	} catch (error) {
		await invoke("discard_staged_media", { id }).catch(() => undefined);
		throw error;
	}
}

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
	/** When it was sent in the chat (unknown for older saves). */
	sentAt?: number;
	fileName: string;
	/** A copy was put in the phone's gallery (Pictures/Movies › Martins Grindr). */
	inGallery?: boolean;
};

function galleryPart(text: string, fallback: string): string {
	const cleaned = text
		.normalize("NFKD")
		.replace(/[^a-zA-Z0-9_-]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 40);
	return cleaned === "" ? fallback : cleaned;
}

function galleryStamp(time: number): string {
	const date = new Date(time);
	const pad = (value: number) => String(value).padStart(2, "0");
	return (
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
		`_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
	);
}

export type ArchivableItem = {
	id: string;
	conversationId: string;
	profileId: number | null;
	kind: ArchivedKind;
	contentType: string;
	name: string | null;
	albumId: number | null;
	/** When it was sent in the chat, if known. */
	sentAt?: number;
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

type PersonRecord = {
	name: string | null;
	mediaHash: string | null;
	/** Last chat activity, so a local-only person still sorts by recency. */
	lastActivity?: number;
};

function readPeople(): Record<string, PersonRecord> {
	try {
		const raw = localStorage.getItem(PEOPLE_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		return typeof parsed === "object" && parsed !== null
			? (parsed as Record<string, PersonRecord>)
			: {};
	} catch {
		return {};
	}
}

async function opfsFile(
	dir: FileSystemDirectoryHandle | null,
	fileName: string,
): Promise<File | null> {
	if (!dir) return null;
	try {
		return await (await dir.getFileHandle(fileName)).getFile();
	} catch {
		return null;
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
	/** Native store in the app; OPFS in a plain browser. */
	readonly #native = typeof window !== "undefined" && isTauri();
	/** Native store: file name -> size, for files known to be there. */
	#stored = new Map<string, number>();
	/** Settles once saved files were checked (and moved off OPFS). */
	readonly ready: Promise<void>;
	/** Saved items whose file had disappeared, found at startup. */
	lost = $state(0);
	/** Whether the Martins Grindr gallery folders show in Gallery/Photos. */
	galleryVisible = $state(false);
	galleryProblem = $state<string | null>(null);
	#galleryDone = new Set<string>();
	/** Copies to the gallery waiting to be written, one at a time. */
	#galleryQueue: string[] = [];
	#galleryRunning = false;
	#entries = $state<Record<string, ArchivedEntry>>({});
	#autoSave = $state<Record<string, true>>({});
	#saving = $state<Record<string, true>>({});

	#urls = new Map<string, string>();
	#supported = $state(true);
	/** Changes still to write to the durable index (native file / server). */
	#indexSet = new Map<string, ArchivedEntry>();
	#indexRemove = new Set<string>();
	#indexTimer: ReturnType<typeof setTimeout> | null = null;
	/** Ids deleted on purpose here, so a sync does not bring them back. */
	#deletedHere = new Set<string>();

	#people = $state<Record<string, PersonRecord>>({});

	constructor() {
		if (typeof localStorage !== "undefined") {
			this.#entries = readManifest();
			this.#autoSave = readAutoSave();
			this.#people = readPeople();
			try {
				const raw: unknown = JSON.parse(
					localStorage.getItem(DELETED_KEY) ?? "[]",
				);
				if (Array.isArray(raw))
					for (const id of raw)
						if (typeof id === "string") this.#deletedHere.add(id);
			} catch {
				/* nothing remembered */
			}
		}
		this.#supported =
			this.#native ||
			(typeof navigator !== "undefined" &&
				typeof (navigator.storage as { getDirectory?: unknown } | undefined)
					?.getDirectory === "function");
		void this.#requestPersistence();
		this.ready =
			typeof window === "undefined"
				? Promise.resolve()
				: this.#applyGalleryVisibility()
						.then(() => this.#reconcile())
						.catch((error: unknown) => {
							console.error("[received-archive] check failed", error);
						})
						.then(() => {
							// Everything already saved also goes to the gallery.
							try {
								const raw: unknown = JSON.parse(
									localStorage.getItem(GALLERY_DONE_KEY) ?? "[]",
								);
								if (Array.isArray(raw))
									for (const id of raw)
										if (typeof id === "string") this.#galleryDone.add(id);
							} catch {
								/* start over: worst case a few copies repeat */
							}
							for (const entry of Object.values(this.#entries))
								if (!entry.inGallery) this.#queueGallery(entry.id);
						})
						.then(() => {
							// Web version: what the phone sends shows up here
							// without reloading the page.
							if (isWebServer())
								setInterval(() => void this.#refreshFromStore(), 60_000);
						});
		if (typeof window !== "undefined")
			window.addEventListener("pagehide", () => void this.#flushIndex());
	}

	/** Queue entries to add (or replace) in the durable index. */
	#indexPut(...entries: ArchivedEntry[]): void {
		if (!this.#native) return;
		for (const entry of entries) {
			this.#indexRemove.delete(entry.id);
			this.#indexSet.set(entry.id, entry);
		}
		this.#scheduleIndex();
	}

	/** Queue ids deleted on purpose (crossing someone out, "Borrar"). */
	#indexDrop(id: string): void {
		if (!this.#native) return;
		this.#indexSet.delete(id);
		this.#indexRemove.add(id);
		this.#scheduleIndex();
	}

	#scheduleIndex(delay = 300): void {
		if (this.#indexTimer === null)
			this.#indexTimer = setTimeout(() => void this.#flushIndex(), delay);
	}

	async #flushIndex(): Promise<void> {
		if (this.#indexTimer !== null) {
			clearTimeout(this.#indexTimer);
			this.#indexTimer = null;
		}
		if (this.#indexSet.size === 0 && this.#indexRemove.size === 0) return;
		const set = Object.fromEntries(this.#indexSet);
		const remove = [...this.#indexRemove];
		this.#indexSet = new Map();
		this.#indexRemove = new Set();
		try {
			await invoke("archive_index_merge", { set, remove });
		} catch (error) {
			console.error("[received-archive] index not written yet", error);
			// Put it back (newer changes win) and try again shortly.
			for (const id of remove)
				if (!this.#indexSet.has(id)) this.#indexRemove.add(id);
			for (const [id, entry] of Object.entries(set))
				if (!this.#indexSet.has(id) && !this.#indexRemove.has(id))
					this.#indexSet.set(id, entry);
			this.#scheduleIndex(5000);
		}
	}

	/**
	 * Bring back from the durable index every entry whose file is in the
	 * store but which is missing from the page's list (localStorage full or
	 * wiped, another tab writing an older list, items sent by the phone…), and
	 * write to the index whatever it does not have yet.
	 */
	async #mergeIndex(): Promise<void> {
		const index = await invoke<Record<string, ArchivedEntry>>(
			"archive_index_read",
		);
		const next = { ...this.#entries };
		let added = 0;
		for (const [id, entry] of Object.entries(index ?? {})) {
			if (
				!entry ||
				typeof entry.fileName !== "string" ||
				typeof entry.conversationId !== "string" ||
				next[id] ||
				!this.#stored.has(entry.fileName)
			)
				continue;
			next[id] = { ...entry, id };
			added += 1;
		}
		if (added > 0) {
			this.#entries = next;
			this.#persistManifest();
			console.info(`[received-archive] ${added} saved items put back from the index`);
		}
		const unknown = Object.values(this.#entries).filter(
			(entry) => !index?.[entry.id],
		);
		if (unknown.length > 0) this.#indexPut(...unknown);
	}

	/** Web version: list again what is in the store (the phone may have sent
	 *  more) and show it. */
	async #refreshFromStore(): Promise<void> {
		try {
			const files = await invoke<{ name: string; size: number }[]>(
				"archive_store_list",
			);
			for (const file of files) this.#stored.set(file.name, file.size);
			await this.#mergeIndex();
		} catch (error) {
			console.error("[received-archive] refresh failed", error);
		}
	}

	/** Every entry with a file in the native store (what a sync compares). */
	storedEntries(): ArchivedEntry[] {
		return Object.values(this.#entries).filter((entry) =>
			this.#stored.has(entry.fileName),
		);
	}

	/** Register a file the native side just wrote (brought from the home
	 *  server by "Sincronizar"). */
	adoptStored(entry: ArchivedEntry, size: number): void {
		this.#stored.set(entry.fileName, size);
		if (this.#entries[entry.id]) return;
		const adopted = { ...entry, inGallery: false };
		this.#entries = { ...this.#entries, [entry.id]: adopted };
		this.#persistManifest();
		this.#indexPut(adopted);
		this.#queueGallery(entry.id);
	}

	/** Hidden by default; the folders show only when asked for. */
	async #applyGalleryVisibility(): Promise<void> {
		try {
			this.galleryVisible =
				localStorage.getItem(GALLERY_VISIBLE_KEY) === "true";
		} catch {
			this.galleryVisible = false;
		}
		if (!this.#native) return;
		try {
			await invoke("gallery_folder_visibility", {
				visible: this.galleryVisible,
			});
			this.galleryProblem = null;
		} catch (error) {
			console.error("[received-archive] gallery visibility", error);
			this.galleryProblem = String(error);
		}
	}

	async setGalleryVisible(visible: boolean): Promise<void> {
		this.galleryVisible = visible;
		try {
			localStorage.setItem(GALLERY_VISIBLE_KEY, String(visible));
		} catch {
			/* still applied for now */
		}
		await this.#applyGalleryVisibility();
	}

	#queueGallery(id: string): void {
		if (!this.#native || this.#galleryDone.has(id)) return;
		if (this.#galleryQueue.includes(id)) return;
		this.#galleryQueue.push(id);
		if (!this.#galleryRunning) void this.#drainGallery();
	}

	async #drainGallery(): Promise<void> {
		this.#galleryRunning = true;
		let unsaved = 0;
		const persist = () => {
			unsaved = 0;
			try {
				localStorage.setItem(
					GALLERY_DONE_KEY,
					JSON.stringify([...this.#galleryDone]),
				);
			} catch {
				/* storage full: copies may repeat next time */
			}
		};
		try {
			for (let id = this.#galleryQueue.shift(); id; id = this.#galleryQueue.shift()) {
				const entry = this.#entries[id];
				if (
					!entry ||
					entry.inGallery ||
					this.#galleryDone.has(id) ||
					!this.#stored.has(entry.fileName)
				)
					continue;
				const base = this.galleryBase(entry);
				try {
					await invoke("archive_store_to_gallery", {
						fileName: entry.fileName,
						baseName: base,
						isVideo: entry.kind === "video",
						contentType: entry.contentType || null,
					});
					this.#galleryDone.add(id);
					if (++unsaved >= 25) persist();
				} catch (error) {
					console.error("[received-archive] gallery copy failed", error);
				}
				// Let the app breathe between files.
				await new Promise((resolve) => setTimeout(resolve, 30));
			}
		} finally {
			if (unsaved > 0) persist();
			this.#galleryRunning = false;
		}
	}

	/**
	 * Make the list match the files: move anything still in OPFS into the
	 * native store, and drop entries whose file is gone, so they are fetched
	 * again (if still on Grindr) or restored from a backup. Nothing is dropped
	 * unless the store could be listed.
	 */
	async #reconcile(): Promise<void> {
		const entries = Object.values(this.#entries);
		if (entries.length === 0 && !this.#native) return;
		const opfs = await archiveDir(false);
		const missing: string[] = [];
		if (this.#native) {
			const files = await invoke<{ name: string; size: number }[]>(
				"archive_store_list",
			);
			this.#stored = new Map(files.map((file) => [file.name, file.size]));
			try {
				await this.#mergeIndex();
			} catch (error) {
				console.error("[received-archive] index check failed", error);
			}
			for (const entry of entries) {
				if (this.#stored.has(entry.fileName)) continue;
				const old = await opfsFile(opfs, entry.fileName);
				if (old && old.size > 0) {
					try {
						const id = await stageBytes(old);
						const size = await invoke<number>("archive_store_staged", {
							id,
							fileName: entry.fileName,
						});
						this.#stored.set(entry.fileName, size);
						await opfs?.removeEntry(entry.fileName).catch(() => undefined);
						continue;
					} catch (error) {
						// Keep it listed: the OPFS copy is still there to retry.
						console.error("[received-archive] move failed", error);
						continue;
					}
				}
				missing.push(entry.id);
			}
		} else {
			if (!opfs) return;
			for (const entry of entries) {
				const file = await opfsFile(opfs, entry.fileName);
				if (!file || file.size === 0) missing.push(entry.id);
			}
		}
		if (missing.length === 0) return;
		const next = { ...this.#entries };
		for (const id of missing) delete next[id];
		this.#entries = next;
		this.#persistManifest();
		this.lost = missing.length;
		console.warn(
			`[received-archive] ${missing.length} saved files were missing; unlisted so they can be saved again`,
		);
	}

	/** `persona_id/fecha_id`: where a copy of this entry goes, one folder per
	 *  person (the phone's gallery and the home server use the same names). */
	galleryBase(entry: ArchivedEntry): string {
		const person = this.#people[entry.conversationId]?.name ?? entry.name;
		const folder =
			galleryPart(person ?? "", "Sin_nombre") +
			"_" +
			galleryPart(String(entry.profileId ?? entry.conversationId), "chat");
		return (
			folder +
			"/" +
			galleryStamp(entry.sentAt ?? entry.savedAt) +
			"_" +
			galleryPart(entry.id.slice(-10), "x")
		);
	}

	/** Whether the file of this entry is in the native store. */
	isStored(entry: ArchivedEntry): boolean {
		return this.#stored.has(entry.fileName);
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
	savedPeople(): (ArchivedPerson & {
		count: number;
		lastSavedAt: number;
		/** Newest known chat send date among the saved items (0 = unknown). */
		lastSentAt: number;
		lastActivity: number | null;
		profileId: number | null;
		hasAlbum: boolean;
		hasDirect: boolean;
	})[] {
		const byConv: Record<
			string,
			{
				count: number;
				lastSavedAt: number;
				lastSentAt: number;
				profileId: number | null;
				hasAlbum: boolean;
				hasDirect: boolean;
			}
		> = {};
		for (const entry of Object.values(this.#entries)) {
			const prev = byConv[entry.conversationId];
			byConv[entry.conversationId] = {
				count: (prev?.count ?? 0) + 1,
				lastSavedAt: Math.max(prev?.lastSavedAt ?? 0, entry.savedAt),
				lastSentAt: Math.max(prev?.lastSentAt ?? 0, entry.sentAt ?? 0),
				profileId: prev?.profileId ?? entry.profileId,
				hasAlbum: (prev?.hasAlbum ?? false) || entry.albumId !== null,
				hasDirect: (prev?.hasDirect ?? false) || entry.albumId === null,
			};
		}
		return Object.entries(byConv)
			.map(([conversationId, stats]) => ({
				conversationId,
				name: this.#people[conversationId]?.name ?? null,
				mediaHash: this.#people[conversationId]?.mediaHash ?? null,
				lastActivity: this.#people[conversationId]?.lastActivity ?? null,
				...stats,
			}))
			.sort((a, b) => b.lastSavedAt - a.lastSavedAt);
	}

	notePerson(
		conversationId: string,
		person: PersonRecord,
	): void {
		const prev = this.#people[conversationId];
		const next: PersonRecord = {
			...prev,
			...person,
			lastActivity: person.lastActivity ?? prev?.lastActivity,
		};
		if (
			prev &&
			prev.name === next.name &&
			prev.mediaHash === next.mediaHash &&
			prev.lastActivity === next.lastActivity
		)
			return;
		this.#people = { ...this.#people, [conversationId]: next };
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
			const fileName = fileNameFor(item.id);
			let contentType = item.contentType;
			if (this.#native) {
				const size = await invoke<number>("archive_store_url", {
					url: item.rawUrl,
					isVideo: item.kind === "video",
					fileName,
				});
				this.#stored.set(fileName, size);
			} else {
				const blob = await fetchArchiveBlob(item);
				const dir = await archiveDir(true);
				if (!dir) {
					this.#supported = false;
					return false;
				}
				const handle = await dir.getFileHandle(fileName, { create: true });
				const writable = await handle.createWritable();
				await writable.write(blob);
				await writable.close();
				contentType ||= blob.type;
			}
			const entry: ArchivedEntry = {
				id: item.id,
				conversationId: item.conversationId,
				profileId: item.profileId,
				kind: item.kind,
				contentType:
					contentType || (item.kind === "video" ? "video/mp4" : "image/jpeg"),
				name: item.name,
				albumId: item.albumId,
				savedAt: Date.now(),
				sentAt: item.sentAt,
				fileName,
			};
			this.#entries = { ...this.#entries, [item.id]: entry };
			this.#persistManifest();
			this.#indexPut(entry);
			this.#setDeletedHere(item.id, false);
			this.#queueGallery(item.id);
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
			if (this.#native) {
				await invoke("archive_store_remove", { fileName: entry.fileName });
				this.#stored.delete(entry.fileName);
			} else {
				const dir = await archiveDir(false);
				await dir?.removeEntry(entry.fileName);
			}
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
		this.#indexDrop(id);
		this.#setDeletedHere(id, true);
	}

	/** Deleted on purpose on this device. */
	wasDeletedHere(id: string): boolean {
		return this.#deletedHere.has(id);
	}

	#setDeletedHere(id: string, deleted: boolean): void {
		if (this.#deletedHere.has(id) === deleted) return;
		if (deleted) this.#deletedHere.add(id);
		else this.#deletedHere.delete(id);
		try {
			localStorage.setItem(DELETED_KEY, JSON.stringify([...this.#deletedHere]));
		} catch {
			/* storage unavailable */
		}
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

	/** The stored file itself (for backups), or null if it cannot be read. */
	async file(id: string): Promise<ByteSource | null> {
		await this.ready;
		const entry = this.#entries[id];
		if (!entry) return null;
		if (this.#native) {
			const size = this.#stored.get(entry.fileName);
			return size ? new StoredSource(entry.fileName, 0, size) : null;
		}
		return await opfsFile(await archiveDir(false), entry.fileName);
	}

	/**
	 * Put back an item from a backup: writes its bytes and registers it. An
	 * item that is already archived is left alone.
	 */
	async importEntry(entry: ArchivedEntry, blob: Blob): Promise<boolean> {
		if (this.isArchived(entry.id)) return false;
		const fileName = fileNameFor(entry.id);
		if (this.#native) {
			const id = await stageBytes(blob);
			const size = await invoke<number>("archive_store_staged", {
				id,
				fileName,
			});
			this.#stored.set(fileName, size);
		} else {
			const dir = await archiveDir(true);
			if (!dir) {
				this.#supported = false;
				throw new Error("Este dispositivo no permite guardar archivos");
			}
			const handle = await dir.getFileHandle(fileName, { create: true });
			const writable = await handle.createWritable();
			await writable.write(blob);
			await writable.close();
		}
		const imported = { ...entry, fileName };
		this.#entries = { ...this.#entries, [entry.id]: imported };
		this.#persistManifest();
		this.#indexPut(imported);
		this.#queueGallery(entry.id);
		return true;
	}

	/** Object URL for the locally stored copy, or null if it cannot be read. */
	async objectUrl(id: string): Promise<string | null> {
		const cached = this.#urls.get(id);
		if (cached) return cached;
		const entry = this.#entries[id];
		if (!entry) return null;
		try {
			await this.ready;
			let blob: Blob | null;
			if (this.#native) {
				const size = this.#stored.get(entry.fileName);
				blob = size
					? new Blob(
							[await new StoredSource(entry.fileName, 0, size).arrayBuffer()],
							{ type: entry.contentType },
						)
					: null;
			} else {
				blob = await opfsFile(await archiveDir(false), entry.fileName);
			}
			if (!blob) return null;
			const url = URL.createObjectURL(blob);
			this.#urls.set(id, url);
			return url;
		} catch {
			return null;
		}
	}
}

export const receivedArchive = new ReceivedArchive();
