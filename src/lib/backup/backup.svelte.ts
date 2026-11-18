// Backup and restore of what only lives on this phone: the received-media
// archive and the app's local settings (notes, phrases, crossed profiles…),
// plus a readable copy of the chats. Everything goes into one plain zip the
// user can open with any file manager.
//
// Chats themselves live on Grindr's servers, so they come back on their own
// after signing in again; the copy in the zip is for reading, and it keeps
// what was there on the day of the backup.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { toast } from "svelte-sonner";

import { getConversations } from "$lib/api/messaging/conversations";
import {
	ConversationUnavailableError,
	getConversationMessages,
} from "$lib/api/messaging/messages";
import {
	type ArchivedEntry,
	MANIFEST_KEY,
	receivedArchive,
} from "$lib/received/archive.svelte";
import { fromBase64, toBase64 } from "$lib/util/base64";
import {
	type ByteSource,
	readZipEntries,
	type ZipEntry,
	zipEntryBlob,
	zipEntrySource,
	zipEntryText,
	type ZipSink,
	ZipWriter,
} from "./zip";

const FORMAT = "open-grind-backup";
const STAGE_CHUNK = 3 * 1024 * 1024;
const REQUEST_PAUSE_MS = 200;
const MAX_INBOX_PAGES = 300;
const MAX_MESSAGE_PAGES = 400;
const RANGE_CHUNK = 4 * 1024 * 1024;
const TARGET_KEY = "backup-target-v1";
/** Suggested name for a backup meant to be updated in place. */
const UPDATABLE_NAME = "backup-martins-grindr.zip";

// Never written to a backup: secrets, per-device state, and the archive
// manifest (rebuilt entry by entry on restore).
const SKIPPED_SETTINGS = new Set([
	MANIFEST_KEY,
	"gemini-api-key-v1",
	"vision-queue-v1",
	TARGET_KEY,
]);
const SKIPPED_SETTING_PREFIX = "open-grind:app-data:";

function settingAllowed(key: string): boolean {
	return !SKIPPED_SETTINGS.has(key) && !key.startsWith(SKIPPED_SETTING_PREFIX);
}

class Cancelled extends Error {}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function pad(value: number): string {
	return String(value).padStart(2, "0");
}

function fileStamp(date: Date): string {
	return (
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
		`_${pad(date.getHours())}${pad(date.getMinutes())}`
	);
}

function safeName(text: string, fallback: string): string {
	const cleaned = text
		.normalize("NFKD")
		.replace(/[^a-zA-Z0-9 ._-]/g, "")
		.trim()
		.replace(/\s+/g, "_")
		.slice(0, 40);
	return cleaned === "" || /^\.+$/.test(cleaned) ? fallback : cleaned;
}

function extensionFor(entry: ArchivedEntry): string {
	const type = entry.contentType.toLowerCase();
	if (entry.kind === "video" || type.startsWith("video/"))
		return type.includes("webm") ? "webm" : "mp4";
	if (type.includes("webp")) return "webp";
	if (type.includes("png")) return "png";
	if (type.includes("gif")) return "gif";
	return "jpg";
}

function escapeHtml(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function keepAlive(command: string, args: Record<string, unknown>) {
	if (!isTauri()) return;
	void invoke(command, args).catch(() => {
		/* best effort: the backup still runs while the app is open */
	});
}

/** The file the last backup went to, so it can be updated in place. */
export type BackupTarget = {
	/** Opaque native handle; null for a plain browser download. */
	uri: string | null;
	/** Where it is, in words. */
	label: string;
	name: string;
	updatedAt: number;
};

function loadTarget(): BackupTarget | null {
	try {
		const raw: unknown = JSON.parse(localStorage.getItem(TARGET_KEY) ?? "null");
		if (typeof raw !== "object" || raw === null) return null;
		const value = raw as Partial<BackupTarget>;
		if (typeof value.label !== "string" || typeof value.name !== "string")
			return null;
		return {
			uri: typeof value.uri === "string" ? value.uri : null,
			label: value.label,
			name: value.name,
			updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
		};
	} catch {
		return null;
	}
}

type NativeTarget = { uri: string; label: string; name: string };

export type BackupDestination = "downloads" | "pick" | "update";

type Close =
	| { kind: "downloads"; fileName: string }
	| { kind: "uri"; uri: string };

type Sink = {
	write: ZipSink;
	close: (where: Close) => Promise<{ uri: string | null; label: string; name: string }>;
	abort: () => Promise<void>;
};

/** A file copied into the native staging cache, read in pieces on demand. */
class StagedSource implements ByteSource {
	readonly #id: string;
	readonly #start: number;
	readonly size: number;

	constructor(id: string, start: number, size: number) {
		this.#id = id;
		this.#start = start;
		this.size = size;
	}

	slice(start = 0, end = this.size): ByteSource {
		const from = Math.min(Math.max(start, 0), this.size);
		const to = Math.min(Math.max(end, from), this.size);
		return new StagedSource(this.#id, this.#start + from, to - from);
	}

	async arrayBuffer(): Promise<ArrayBuffer> {
		const out = new Uint8Array(this.size);
		let filled = 0;
		while (filled < this.size) {
			const chunk = fromBase64(
				String(
					await invoke("read_staged_range", {
						id: this.#id,
						offset: this.#start + filled,
						length: Math.min(RANGE_CHUNK, this.size - filled),
					}),
				),
			);
			if (chunk.length === 0) break;
			out.set(chunk, filled);
			filled += chunk.length;
		}
		return out.buffer;
	}
}

async function discardStaged(id: string): Promise<void> {
	try {
		await invoke("discard_staged_media", { id });
	} catch {
		/* cleared on the next app start anyway */
	}
}

/** What an earlier backup holds, for carrying it over into an update. */
type OldBackup = {
	stagedId: string;
	file: ByteSource;
	prefix: string;
	entries: ZipEntry[];
	byName: Map<string, ZipEntry>;
	items: IndexedItem[];
};

// The zip is streamed into a native temp file in small pieces, then moved to
// the public Download folder in one go.
async function nativeSink(): Promise<Sink> {
	const id = String(await invoke("stage_media"));
	const buffer = new Uint8Array(STAGE_CHUNK);
	let used = 0;
	const flush = async () => {
		if (used === 0) return;
		await invoke("append_staged_media", {
			id,
			chunk: toBase64(buffer.subarray(0, used)),
		});
		used = 0;
	};
	return {
		write: async (bytes) => {
			let at = 0;
			while (at < bytes.length) {
				const take = Math.min(bytes.length - at, STAGE_CHUNK - used);
				buffer.set(bytes.subarray(at, at + take), used);
				used += take;
				at += take;
				if (used === STAGE_CHUNK) await flush();
			}
		},
		close: async (where) => {
			await flush();
			return where.kind === "downloads"
				? await invoke<NativeTarget>("export_backup_to_downloads", {
						id,
						fileName: where.fileName,
					})
				: await invoke<NativeTarget>("write_backup_to_uri", {
						id,
						uri: where.uri,
					});
		},
		abort: () => discardStaged(id),
	};
}

function webSink(): Sink {
	const parts: Blob[] = [];
	return {
		write: (bytes) => {
			parts.push(new Blob([bytes.slice().buffer as ArrayBuffer]));
			return Promise.resolve();
		},
		close: (where) => {
			const fileName =
				where.kind === "downloads" ? where.fileName : UPDATABLE_NAME;
			const url = URL.createObjectURL(
				new Blob(parts, { type: "application/zip" }),
			);
			const link = document.createElement("a");
			link.href = url;
			link.download = fileName;
			link.click();
			setTimeout(() => URL.revokeObjectURL(url), 60_000);
			return Promise.resolve({
				uri: null,
				label: "las descargas del navegador",
				name: fileName,
			});
		},
		abort: () => Promise.resolve(),
	};
}

type IndexedItem = { entry: ArchivedEntry; path: string };

type ChatMessage = {
	messageId: string;
	senderId: number;
	timestamp: number;
	type: string;
	body: unknown;
	unsent?: boolean;
};

function describeMessage(message: ChatMessage): string {
	if (message.unsent || message.type === "Unsent")
		return "[mensaje eliminado]";
	const body = (
		typeof message.body === "object" && message.body !== null
			? message.body
			: {}
	) as Record<string, unknown>;
	const text = (key: string) =>
		typeof body[key] === "string" ? body[key] : "";
	switch (message.type) {
		case "Text":
			return text("text");
		case "Image":
			return "📷 Foto";
		case "ExpiringImage":
			return "📷 Foto que se ve una sola vez";
		case "Video":
		case "PrivateVideo":
		case "NonExpiringVideo":
			return "🎬 Video";
		case "Audio":
			return "🎤 Audio";
		case "Album":
		case "ExpiringAlbum":
		case "ExpiringAlbumV2":
			return "📁 Álbum compartido";
		case "Location":
			return `📍 Ubicación: https://maps.google.com/?q=${String(body.lat)},${String(body.lon)}`;
		case "Gaymoji":
			return "Sticker";
		case "Giphy":
			return "GIF";
		case "AlbumContentReply":
			return `↩ (sobre una foto de álbum) ${text("albumContentReply")}`;
		case "AlbumContentReaction":
			return "🔥 Reacción a una foto de álbum";
		case "ProfilePhotoReply":
			return `↩ (sobre una foto de perfil) ${text("photoContentReply")}`;
		default:
			return `[${message.type}]`;
	}
}

const PAGE_STYLE =
	"body{font-family:system-ui,sans-serif;background:#111;color:#eee;margin:0;padding:16px;max-width:760px;margin:auto}" +
	"h1{font-size:20px}h2{font-size:15px;color:#aaa;margin-top:24px}a{color:#fc0}" +
	".m{max-width:80%;margin:6px 0;padding:8px 12px;border-radius:14px;white-space:pre-wrap;word-break:break-word}" +
	".in{background:#2a2a2a;margin-right:auto}.out{background:#5a4300;margin-left:auto}" +
	".t{display:block;font-size:11px;opacity:.6;margin-top:2px}.row{display:flex}" +
	".g{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px}" +
	".g img,.g video{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;background:#222}";

function chatPage({
	name,
	otherId,
	messages,
	media,
}: {
	name: string;
	otherId: number | null;
	messages: ChatMessage[];
	media: IndexedItem[];
}): string {
	const gallery =
		media.length === 0
			? ""
			: `<h2>Fotos y videos guardados (${media.length})</h2><div class="g">` +
				media
					.map(({ entry, path }) => {
						const src = "../" + path.split("/").map(encodeURIComponent).join("/");
						return entry.kind === "video"
							? `<video controls preload="none" src="${src}"></video>`
							: `<a href="${src}"><img loading="lazy" src="${src}" alt=""></a>`;
					})
					.join("") +
				"</div>";
	const bubbles = messages
		.map((message) => {
			const mine = otherId !== null && message.senderId !== otherId;
			const when = new Date(message.timestamp).toLocaleString("es-AR");
			return (
				`<div class="row"><div class="m ${mine ? "out" : "in"}">` +
				escapeHtml(describeMessage(message)) +
				`<span class="t">${mine ? "Yo" : escapeHtml(name)} · ${escapeHtml(when)}</span></div></div>`
			);
		})
		.join("\n");
	return (
		`<!doctype html><html lang="es"><head><meta charset="utf-8">` +
		`<meta name="viewport" content="width=device-width,initial-scale=1">` +
		`<title>${escapeHtml(name)}</title><style>${PAGE_STYLE}</style></head><body>` +
		`<p><a href="_indice.html">← Todos los chats</a></p><h1>${escapeHtml(name)}</h1>` +
		gallery +
		`<h2>Mensajes (${messages.length})</h2>\n${bubbles}\n</body></html>`
	);
}

function indexPage(chats: { name: string; file: string; count: number }[]) {
	const rows = chats
		.map(
			(chat) =>
				`<li><a href="${encodeURIComponent(chat.file)}">${escapeHtml(chat.name)}</a> · ${chat.count} mensajes</li>`,
		)
		.join("\n");
	return (
		`<!doctype html><html lang="es"><head><meta charset="utf-8">` +
		`<meta name="viewport" content="width=device-width,initial-scale=1">` +
		`<title>Chats</title><style>${PAGE_STYLE}li{margin:8px 0}</style></head><body>` +
		`<h1>Chats (${chats.length})</h1><ul>\n${rows}\n</ul></body></html>`
	);
}

const README =
	"BACKUP DE MARTINS GRINDR\n" +
	"========================\n\n" +
	"recibidos/  Fotos y videos que te mandaron y guardaste, una carpeta por persona.\n" +
	"chats/      Los chats para leer: abrí _indice.html con el navegador.\n" +
	"datos/      Lo que usa la app para restaurar. No lo modifiques.\n\n" +
	"Para restaurar: en la app, Configuración → App → Backup → Restaurar backup,\n" +
	"y elegí este archivo .zip (sin descomprimir).\n\n" +
	"Se restauran los recibidos y los ajustes de la app (notas, frases, saludo,\n" +
	"descartados, filtros). Los chats no hace falta restaurarlos: vuelven solos\n" +
	"desde Grindr al iniciar sesión. La copia de chats/ es para leerlos.\n" +
	"La clave de Gemini no se guarda en el backup.\n";

type PendingRestore = {
	file: File;
	prefix: string;
	byName: Map<string, ZipEntry>;
	items: IndexedItem[];
	settings: Record<string, string>;
	createdAt: number | null;
	/** Items in the backup that this phone doesn't have yet. */
	newItems: number;
};

function parseItems(raw: unknown): IndexedItem[] {
	if (!Array.isArray(raw)) return [];
	const items: IndexedItem[] = [];
	for (const candidate of raw as unknown[]) {
		if (typeof candidate !== "object" || candidate === null) continue;
		const { entry, path } = candidate as {
			entry?: Partial<ArchivedEntry>;
			path?: unknown;
		};
		if (
			typeof path !== "string" ||
			!entry ||
			typeof entry.id !== "string" ||
			typeof entry.conversationId !== "string" ||
			(entry.kind !== "image" && entry.kind !== "video")
		)
			continue;
		items.push({
			path,
			entry: {
				id: entry.id,
				conversationId: entry.conversationId,
				profileId:
					typeof entry.profileId === "number" ? entry.profileId : null,
				kind: entry.kind,
				contentType:
					typeof entry.contentType === "string" ? entry.contentType : "",
				name: typeof entry.name === "string" ? entry.name : null,
				albumId: typeof entry.albumId === "number" ? entry.albumId : null,
				savedAt:
					typeof entry.savedAt === "number" ? entry.savedAt : Date.now(),
				sentAt: typeof entry.sentAt === "number" ? entry.sentAt : undefined,
				fileName: "",
			},
		});
	}
	return items;
}

type ChatsState = {
	index: { name: string; file: string; count: number }[];
	usedFiles: Set<string>;
	/** Conversations already written. */
	done: Set<string>;
};

class Backup {
	running = $state<"export" | "restore" | null>(null);
	step = $state("");
	done = $state(0);
	total = $state(0);
	/** Where the last backup was written, or how the last restore went. */
	lastResult = $state<string | null>(null);
	pending = $state.raw<PendingRestore | null>(null);
	/** The file the last backup went to, offered for updating. */
	target = $state<BackupTarget | null>(loadTarget());
	#cancelled = false;

	cancel(): void {
		this.#cancelled = true;
	}

	#checkpoint(): void {
		if (this.#cancelled) throw new Cancelled();
	}

	#progress(step: string, done: number, total: number): void {
		this.step = step;
		this.done = done;
		this.total = total;
	}

	async exportAll({
		includeChats,
		destination,
	}: {
		includeChats: boolean;
		destination: BackupDestination;
	}): Promise<void> {
		if (this.running) return;
		const now = new Date();
		const previous = this.target;
		if (destination === "update" && previous?.uri == null) return;

		// Ask where to save before the long part, not after it.
		let chosen: NativeTarget | null = null;
		if (destination === "pick") {
			try {
				chosen = await invoke<NativeTarget | null>(
					"pick_backup_destination",
					{ fileName: UPDATABLE_NAME },
				);
			} catch (error) {
				console.error("[backup] picker failed", error);
				this.lastResult = `No se pudo abrir el selector: ${error instanceof Error ? error.message : String(error)}`;
				return;
			}
			if (!chosen) return;
		}

		this.running = "export";
		this.#cancelled = false;
		this.lastResult = null;
		this.#progress("Preparando…", 0, 0);
		keepAlive("search_keepalive_hold", { text: "Armando el backup…" });
		let sink: Sink | null = null;
		let old: OldBackup | null = null;
		let oldUnreadable = false;
		let finished = false;
		try {
			if (destination === "update" && previous?.uri) {
				this.#progress("Leyendo el backup anterior…", 0, 0);
				old = await this.#openOld(previous.uri);
				oldUnreadable = old === null;
			}
			sink = isTauri() ? await nativeSink() : webSink();
			const zip = new ZipWriter(sink.write);

			// 1. Received media, one folder per person.
			const people = new Map(
				receivedArchive
					.savedPeople()
					.map((person) => [person.conversationId, person]),
			);
			const entries = receivedArchive.all;
			const items: IndexedItem[] = [];
			const usedPaths = new Set<string>();
			const uniquePath = (wanted: string) => {
				const dot = wanted.lastIndexOf(".");
				const base = dot > 0 ? wanted.slice(0, dot) : wanted;
				const extension = dot > 0 ? wanted.slice(dot) : "";
				let path = wanted;
				for (let copy = 2; usedPaths.has(path); copy += 1)
					path = `${base}_${copy}${extension}`;
				usedPaths.add(path);
				return path;
			};
			let unreadable = 0;
			for (const [index, entry] of entries.entries()) {
				this.#checkpoint();
				this.#progress("Guardando fotos y videos", index, entries.length);
				const file = await receivedArchive.file(entry.id);
				if (!file) {
					unreadable += 1;
					continue;
				}
				const person = people.get(entry.conversationId);
				const folder =
					safeName(person?.name ?? entry.name ?? "", "sin-nombre") +
					"_" +
					safeName(
						String(entry.profileId ?? entry.conversationId),
						"chat",
					);
				const when = new Date(entry.sentAt ?? entry.savedAt);
				const path = uniquePath(
					`recibidos/${folder}/${fileStamp(when)}.${extensionFor(entry)}`,
				);
				await zip.add(path, file, when);
				items.push({ entry, path });
			}

			// 1b. Updating: keep what the earlier backup had that this phone
			// no longer does, so an update never loses anything.
			let carried = 0;
			if (old) {
				const have = new Set(items.map((item) => item.entry.id));
				const todo = old.items.filter((item) => !have.has(item.entry.id));
				for (const [index, item] of todo.entries()) {
					this.#checkpoint();
					this.#progress(
						"Conservando lo del backup anterior",
						index,
						todo.length,
					);
					const zipped = old.byName.get(old.prefix + item.path);
					if (!zipped) continue;
					try {
						const path = uniquePath(item.path);
						await zip.add(
							path,
							await zipEntrySource(old.file, zipped),
							new Date(item.entry.sentAt ?? item.entry.savedAt),
						);
						items.push({ entry: item.entry, path });
						have.add(item.entry.id);
						carried += 1;
					} catch (error) {
						console.error("[backup] carry-over failed", item.path, error);
					}
				}
			}
			await zip.add("datos/recibidos.json", JSON.stringify(items));

			// 2. Local settings.
			const settings: Record<string, string> = {};
			for (let index = 0; index < localStorage.length; index += 1) {
				const key = localStorage.key(index);
				if (key === null || !settingAllowed(key)) continue;
				const value = localStorage.getItem(key);
				if (value !== null) settings[key] = value;
			}
			await zip.add("datos/ajustes.json", JSON.stringify(settings));

			// 3. Chats, as pages to read.
			const mediaByChat = new Map<string, IndexedItem[]>();
			for (const item of items) {
				const list = mediaByChat.get(item.entry.conversationId) ?? [];
				list.push(item);
				mediaByChat.set(item.entry.conversationId, list);
			}
			const chats: ChatsState = {
				index: [],
				usedFiles: new Set(),
				done: new Set(),
			};
			let chatsIncomplete = false;
			if (includeChats) {
				chatsIncomplete = await this.#exportChats(zip, mediaByChat, chats);
			}
			let chatsCarried = 0;
			if (old) chatsCarried = await this.#carryChats(zip, old, mediaByChat, chats);
			if (chats.index.length > 0) {
				chats.index.sort((a, b) => a.name.localeCompare(b.name));
				await zip.add("chats/_indice.html", indexPage(chats.index));
			}

			await zip.add("LEEME.txt", README);
			await zip.add(
				"datos/backup.json",
				JSON.stringify({
					format: FORMAT,
					version: 1,
					createdAt: now.getTime(),
					received: items.length,
					chats: chats.index.length,
				}),
			);
			this.#checkpoint();
			this.#progress("Guardando el archivo…", 0, 0);
			const size = await zip.finish();
			const written = await sink.close(
				destination === "downloads"
					? {
							kind: "downloads",
							fileName: `backup-martins-grindr-${fileStamp(now)}.zip`,
						}
					: {
							kind: "uri",
							uri: (chosen?.uri ?? previous?.uri) as string,
						},
			);
			finished = true;
			this.#saveTarget({ ...written, updatedAt: now.getTime() });
			const megabytes = Math.max(1, Math.round(size / (1024 * 1024)));
			const where = `${written.label} → ${written.name}`;
			this.lastResult =
				(destination === "update" ? "Backup actualizado" : "Backup guardado") +
				` en ${where} (${megabytes} MB): ${items.length} fotos/videos` +
				(chats.index.length > 0 ? `, ${chats.index.length} chats` : "") +
				"." +
				(carried + chatsCarried > 0
					? ` Se conservaron del backup anterior ${carried} fotos/videos y ${chatsCarried} chats que ya no estaban en el teléfono.`
					: "") +
				(oldUnreadable
					? " No se pudo leer el backup anterior, así que se guardó solo lo que hay ahora."
					: "") +
				(unreadable > 0
					? ` ${unreadable} archivos no se pudieron leer.`
					: "") +
				(chatsIncomplete
					? " Grindr cortó la descarga de chats antes de terminar; faltan algunos."
					: "");
			toast.success(
				destination === "update" ? "Backup actualizado" : "Backup listo",
				{ description: where },
			);
		} catch (error) {
			if (error instanceof Cancelled) {
				this.lastResult =
					destination === "update"
						? "Actualización cancelada; el backup anterior quedó como estaba."
						: "Backup cancelado.";
			} else {
				console.error("[backup] export failed", error);
				this.lastResult = `No se pudo ${destination === "update" ? "actualizar" : "crear"} el backup: ${error instanceof Error ? error.message : String(error)}`;
				toast.error("No se pudo guardar el backup");
			}
		} finally {
			if (!finished) await sink?.abort();
			if (old) await discardStaged(old.stagedId);
			keepAlive("search_keepalive_release", {
				doneText: finished ? "Backup listo" : null,
			});
			this.running = null;
		}
	}

	#saveTarget(target: BackupTarget): void {
		this.target = target;
		try {
			localStorage.setItem(TARGET_KEY, JSON.stringify(target));
		} catch {
			/* storage unavailable: it just won't be offered for updating */
		}
	}

	/** Stop offering to update the last backup (the file stays where it is). */
	forgetTarget(): void {
		this.target = null;
		try {
			localStorage.removeItem(TARGET_KEY);
		} catch {
			/* ignore */
		}
	}

	async #openOld(uri: string): Promise<OldBackup | null> {
		const staged = await invoke<{ id: string; size: number } | null>(
			"stage_backup_from_uri",
			{ uri },
		).catch(() => null);
		if (!staged) return null;
		try {
			const file = new StagedSource(staged.id, 0, staged.size);
			const entries = await readZipEntries(file);
			const marker = entries.find((entry) =>
				entry.name.endsWith("datos/backup.json"),
			);
			if (!marker) throw new Error("not a backup");
			const prefix = marker.name.slice(0, -"datos/backup.json".length);
			const byName = new Map(entries.map((entry) => [entry.name, entry]));
			const itemsEntry = byName.get(`${prefix}datos/recibidos.json`);
			const items = itemsEntry
				? parseItems(JSON.parse(await zipEntryText(file, itemsEntry)))
				: [];
			return { stagedId: staged.id, file, prefix, entries, byName, items };
		} catch (error) {
			console.error("[backup] earlier backup unreadable", error);
			await discardStaged(staged.id);
			return null;
		}
	}

	/** Chats the earlier backup had and this one didn't download. */
	async #carryChats(
		zip: ZipWriter,
		old: OldBackup,
		mediaByChat: Map<string, IndexedItem[]>,
		chats: ChatsState,
	): Promise<number> {
		const folder = `${old.prefix}datos/chats/`;
		const candidates = old.entries.filter(
			(entry) => entry.name.startsWith(folder) && entry.name.endsWith(".json"),
		);
		let carried = 0;
		for (const [index, entry] of candidates.entries()) {
			this.#checkpoint();
			this.#progress("Conservando chats del backup anterior", index, candidates.length);
			try {
				const saved = JSON.parse(await zipEntryText(old.file, entry)) as {
					conversationId?: unknown;
					name?: unknown;
					profileId?: unknown;
					messages?: unknown;
				};
				if (typeof saved.conversationId !== "string") continue;
				if (chats.done.has(saved.conversationId)) continue;
				await this.#writeChat(zip, chats, {
					conversationId: saved.conversationId,
					name: typeof saved.name === "string" ? saved.name : "Sin nombre",
					otherId:
						typeof saved.profileId === "number" ? saved.profileId : null,
					messages: Array.isArray(saved.messages)
						? (saved.messages as ChatMessage[])
						: [],
					media: mediaByChat.get(saved.conversationId) ?? [],
				});
				carried += 1;
			} catch (error) {
				console.error("[backup] old chat unreadable", entry.name, error);
			}
		}
		return carried;
	}

	async #writeChat(
		zip: ZipWriter,
		chats: ChatsState,
		chat: {
			conversationId: string;
			name: string;
			otherId: number | null;
			messages: ChatMessage[];
			media: IndexedItem[];
		},
	): Promise<void> {
		const base =
			safeName(chat.name, "chat") +
			"_" +
			safeName(String(chat.otherId ?? chat.conversationId), "id");
		let file = `${base}.html`;
		for (let copy = 2; chats.usedFiles.has(file); copy += 1)
			file = `${base}_${copy}.html`;
		chats.usedFiles.add(file);
		await zip.add(
			`chats/${file}`,
			chatPage({
				name: chat.name,
				otherId: chat.otherId,
				messages: chat.messages,
				media: chat.media,
			}),
		);
		await zip.add(
			`datos/chats/${safeName(chat.conversationId, "chat")}.json`,
			JSON.stringify({
				conversationId: chat.conversationId,
				name: chat.name,
				profileId: chat.otherId,
				messages: chat.messages,
			}),
		);
		chats.index.push({
			name: chat.name,
			file,
			count: chat.messages.length,
		});
		chats.done.add(chat.conversationId);
	}

	/** Downloads every chat into the zip. Returns whether some were missed. */
	async #exportChats(
		zip: ZipWriter,
		mediaByChat: Map<string, IndexedItem[]>,
		chats: ChatsState,
	): Promise<boolean> {
		// The inbox first, so there is a total to show progress against.
		const inbox: { conversationId: string; name: string }[] = [];
		let incomplete = false;
		try {
			let page: number | null = 1;
			for (let turn = 0; page !== null && turn < MAX_INBOX_PAGES; turn += 1) {
				this.#checkpoint();
				this.#progress("Leyendo la lista de chats", inbox.length, 0);
				const result = await getConversations({ page });
				for (const entry of result.entries)
					inbox.push({
						conversationId: entry.data.conversationId,
						name: entry.data.name,
					});
				page =
					result.nextPage !== null && result.nextPage !== page
						? result.nextPage
						: null;
				await sleep(REQUEST_PAUSE_MS);
			}
		} catch (error) {
			if (error instanceof Cancelled) throw error;
			console.error("[backup] inbox failed", error);
			incomplete = true;
		}

		let failuresInARow = 0;
		for (const [position, chat] of inbox.entries()) {
			this.#checkpoint();
			this.#progress("Guardando chats", position, inbox.length);
			try {
				const { messages, otherId, otherName } = await this.#allMessages(
					chat.conversationId,
				);
				failuresInARow = 0;
				await this.#writeChat(zip, chats, {
					conversationId: chat.conversationId,
					name: chat.name || otherName || "Sin nombre",
					otherId,
					messages,
					media: mediaByChat.get(chat.conversationId) ?? [],
				});
			} catch (error) {
				if (error instanceof Cancelled) throw error;
				if (error instanceof ConversationUnavailableError) continue;
				console.error("[backup] chat failed", chat.conversationId, error);
				incomplete = true;
				failuresInARow += 1;
				// Several failures in a row means Grindr is refusing us:
				// stop asking rather than hammer it.
				if (failuresInARow >= 3) break;
				await sleep(5_000);
			}
		}
		return incomplete;
	}
	async #allMessages(conversationId: string): Promise<{
		messages: ChatMessage[];
		otherId: number | null;
		otherName: string | null;
	}> {
		const byId = new Map<string, ChatMessage>();
		let otherId: number | null = null;
		let otherName: string | null = null;
		let pageKey: string | undefined;
		for (let turn = 0; turn < MAX_MESSAGE_PAGES; turn += 1) {
			this.#checkpoint();
			const page = await getConversationMessages({
				conversationId,
				pageKey,
			});
			otherId = page.profile.profileId;
			otherName = page.profile.name;
			const before = byId.size;
			for (const message of page.messages)
				byId.set(message.messageId, {
					messageId: message.messageId,
					senderId: message.senderId,
					timestamp: message.timestamp,
					type: message.type,
					body: message.body,
					unsent: message.unsent,
				});
			await sleep(REQUEST_PAUSE_MS);
			const next = page.messages.at(-1)?.messageId;
			if (next === undefined || next === pageKey || byId.size === before)
				break;
			pageKey = next;
		}
		return {
			messages: [...byId.values()].sort(
				(a, b) => a.timestamp - b.timestamp,
			),
			otherId,
			otherName,
		};
	}

	/** Open a backup file and report what it holds, without changing anything. */
	async inspect(file: File): Promise<void> {
		if (this.running) return;
		this.pending = null;
		this.lastResult = null;
		try {
			const entries = await readZipEntries(file);
			// Tolerate a zip that was unpacked and packed again inside a folder.
			const marker = entries.find((entry) =>
				entry.name.endsWith("datos/backup.json"),
			);
			if (!marker) throw new Error("no es un backup de esta app");
			const prefix = marker.name.slice(0, -"datos/backup.json".length);
			const byName = new Map(entries.map((entry) => [entry.name, entry]));
			const info = JSON.parse(await zipEntryText(file, marker)) as {
				format?: unknown;
				createdAt?: unknown;
			};
			if (info.format !== FORMAT)
				throw new Error("no es un backup de esta app");

			const itemsEntry = byName.get(`${prefix}datos/recibidos.json`);
			const items = itemsEntry
				? parseItems(JSON.parse(await zipEntryText(file, itemsEntry)))
				: [];
			const settingsEntry = byName.get(`${prefix}datos/ajustes.json`);
			const settings: Record<string, string> = {};
			if (settingsEntry) {
				const raw: unknown = JSON.parse(
					await zipEntryText(file, settingsEntry),
				);
				if (typeof raw === "object" && raw !== null)
					for (const [key, value] of Object.entries(raw))
						if (typeof value === "string" && settingAllowed(key))
							settings[key] = value;
			}
			this.pending = {
				file,
				prefix,
				byName,
				items,
				settings,
				createdAt:
					typeof info.createdAt === "number" ? info.createdAt : null,
				newItems: items.filter(
					(item) => !receivedArchive.isArchived(item.entry.id),
				).length,
			};
		} catch (error) {
			console.error("[backup] inspect failed", error);
			this.lastResult = `No se pudo abrir ese archivo: ${error instanceof Error ? error.message : String(error)}.`;
			toast.error("Ese archivo no sirve como backup");
		}
	}

	discardPending(): void {
		this.pending = null;
	}

	async restore(): Promise<void> {
		const pending = this.pending;
		if (!pending || this.running) return;
		this.running = "restore";
		this.#cancelled = false;
		this.pending = null;
		keepAlive("search_keepalive_hold", { text: "Restaurando el backup…" });
		let restored = 0;
		let missing = 0;
		let completed = false;
		try {
			// Media first and settings last: the settings are written right
			// before the reload, so nothing running in the app overwrites them.
			const todo = pending.items.filter(
				(item) => !receivedArchive.isArchived(item.entry.id),
			);
			for (const [index, item] of todo.entries()) {
				this.#checkpoint();
				this.#progress("Restaurando fotos y videos", index, todo.length);
				const zipped = pending.byName.get(pending.prefix + item.path);
				if (!zipped) {
					missing += 1;
					continue;
				}
				try {
					const blob = await zipEntryBlob(
						pending.file,
						zipped,
						item.entry.contentType,
					);
					if (await receivedArchive.importEntry(item.entry, blob))
						restored += 1;
				} catch (error) {
					console.error("[backup] item failed", item.path, error);
					missing += 1;
				}
			}
			this.#checkpoint();
			this.#progress("Restaurando ajustes…", 0, 0);
			for (const [key, value] of Object.entries(pending.settings)) {
				try {
					localStorage.setItem(key, value);
				} catch {
					/* storage full: keep going with the rest */
				}
			}
			completed = true;
			toast.success("Backup restaurado", {
				description: `${restored} fotos/videos recuperados. Reiniciando…`,
			});
			this.lastResult =
				`Backup restaurado: ${restored} fotos/videos recuperados` +
				(missing > 0 ? `, ${missing} no se pudieron leer` : "") +
				".";
			// Everything reads its settings at startup.
			setTimeout(() => location.reload(), 1_500);
		} catch (error) {
			if (error instanceof Cancelled) {
				this.lastResult = `Restauración cancelada: se recuperaron ${restored} fotos/videos y no se tocaron los ajustes.`;
			} else {
				console.error("[backup] restore failed", error);
				this.lastResult = `No se pudo restaurar: ${error instanceof Error ? error.message : String(error)}`;
				toast.error("No se pudo restaurar el backup");
			}
		} finally {
			keepAlive("search_keepalive_release", {
				doneText: completed ? "Backup restaurado" : null,
			});
			this.running = null;
		}
	}
}

export const backup = new Backup();
