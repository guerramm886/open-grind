// A small zip writer and reader for backups. Entries are stored uncompressed
// (photos and videos don't shrink anyway), written as a stream so a multi-GB
// archive never sits in memory, and zip64 records are added only when the
// archive outgrows the classic limits, so any unzip tool can open it.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const MAX_32 = 0xffffffff;
const MAX_16 = 0xffff;
const READ_CHUNK = 2 * 1024 * 1024;

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n += 1) {
		let c = n;
		for (let k = 0; k < 8; k += 1)
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crcUpdate(crc: number, bytes: Uint8Array): number {
	let c = crc;
	for (let i = 0; i < bytes.length; i += 1)
		c = (CRC_TABLE[(c ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
	return c >>> 0;
}

export function crc32(bytes: Uint8Array): number {
	return (crcUpdate(MAX_32, bytes) ^ MAX_32) >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
	const year = Math.max(date.getFullYear(), 1980);
	return {
		time:
			(date.getHours() << 11) |
			(date.getMinutes() << 5) |
			(date.getSeconds() >> 1),
		date:
			((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
	};
}

type WrittenEntry = {
	name: Uint8Array;
	crc: number;
	size: number;
	offset: number;
	time: number;
	date: number;
};

export type ZipSink = (bytes: Uint8Array) => Promise<void>;

/**
 * Anything that can hand out byte ranges: a Blob/File, or a file that lives
 * outside the webview and is read piece by piece.
 */
export interface ByteSource {
	readonly size: number;
	slice(start?: number, end?: number): ByteSource;
	arrayBuffer(): Promise<ArrayBuffer>;
}

export class ZipWriter {
	#sink: ZipSink;
	#offset = 0;
	#entries: WrittenEntry[] = [];

	constructor(sink: ZipSink) {
		this.#sink = sink;
	}

	get entryCount(): number {
		return this.#entries.length;
	}

	async #write(bytes: Uint8Array): Promise<void> {
		await this.#sink(bytes);
		this.#offset += bytes.length;
	}

	async add(
		name: string,
		data: ByteSource | Uint8Array | string,
		modified: Date = new Date(),
	): Promise<void> {
		const content = typeof data === "string" ? encoder.encode(data) : data;
		const size =
			content instanceof Uint8Array ? content.length : content.size;
		if (size >= MAX_32) throw new Error(`"${name}" es demasiado grande`);

		// The header carries the checksum, so a file is read once to compute
		// it and once more to copy it.
		let crc = MAX_32;
		if (!(content instanceof Uint8Array)) {
			for (let at = 0; at < size; at += READ_CHUNK)
				crc = crcUpdate(
					crc,
					new Uint8Array(
						await content.slice(at, at + READ_CHUNK).arrayBuffer(),
					),
				);
		} else crc = crcUpdate(crc, content);
		crc = (crc ^ MAX_32) >>> 0;

		const nameBytes = encoder.encode(name);
		const stamp = dosDateTime(modified);
		const offset = this.#offset;
		const header = new Uint8Array(30 + nameBytes.length);
		const view = new DataView(header.buffer);
		view.setUint32(0, 0x04034b50, true);
		view.setUint16(4, 20, true);
		view.setUint16(6, 0x0800, true); // UTF-8 names
		view.setUint16(8, 0, true); // stored
		view.setUint16(10, stamp.time, true);
		view.setUint16(12, stamp.date, true);
		view.setUint32(14, crc, true);
		view.setUint32(18, size, true);
		view.setUint32(22, size, true);
		view.setUint16(26, nameBytes.length, true);
		view.setUint16(28, 0, true);
		header.set(nameBytes, 30);
		await this.#write(header);

		if (!(content instanceof Uint8Array)) {
			for (let at = 0; at < size; at += READ_CHUNK)
				await this.#write(
					new Uint8Array(
						await content.slice(at, at + READ_CHUNK).arrayBuffer(),
					),
				);
		} else await this.#write(content);

		this.#entries.push({
			name: nameBytes,
			crc,
			size,
			offset,
			time: stamp.time,
			date: stamp.date,
		});
	}

	/** Writes the central directory. Returns the archive's total size. */
	async finish(): Promise<number> {
		const directoryOffset = this.#offset;
		for (const entry of this.#entries) {
			const big = entry.offset >= MAX_32;
			const extraLength = big ? 12 : 0;
			const record = new Uint8Array(46 + entry.name.length + extraLength);
			const view = new DataView(record.buffer);
			view.setUint32(0, 0x02014b50, true);
			view.setUint16(4, 45, true);
			view.setUint16(6, big ? 45 : 20, true);
			view.setUint16(8, 0x0800, true);
			view.setUint16(10, 0, true);
			view.setUint16(12, entry.time, true);
			view.setUint16(14, entry.date, true);
			view.setUint32(16, entry.crc, true);
			view.setUint32(20, entry.size, true);
			view.setUint32(24, entry.size, true);
			view.setUint16(28, entry.name.length, true);
			view.setUint16(30, extraLength, true);
			view.setUint16(32, 0, true);
			view.setUint16(34, 0, true);
			view.setUint16(36, 0, true);
			view.setUint32(38, 0, true);
			view.setUint32(42, big ? MAX_32 : entry.offset, true);
			record.set(entry.name, 46);
			if (big) {
				const at = 46 + entry.name.length;
				view.setUint16(at, 0x0001, true);
				view.setUint16(at + 2, 8, true);
				view.setBigUint64(at + 4, BigInt(entry.offset), true);
			}
			await this.#write(record);
		}
		const directorySize = this.#offset - directoryOffset;
		const count = this.#entries.length;
		const zip64 =
			count > MAX_16 ||
			directoryOffset >= MAX_32 ||
			directorySize >= MAX_32;

		if (zip64) {
			const zip64Offset = this.#offset;
			const record = new Uint8Array(56 + 20);
			const view = new DataView(record.buffer);
			view.setUint32(0, 0x06064b50, true);
			view.setBigUint64(4, 44n, true);
			view.setUint16(12, 45, true);
			view.setUint16(14, 45, true);
			view.setUint32(16, 0, true);
			view.setUint32(20, 0, true);
			view.setBigUint64(24, BigInt(count), true);
			view.setBigUint64(32, BigInt(count), true);
			view.setBigUint64(40, BigInt(directorySize), true);
			view.setBigUint64(48, BigInt(directoryOffset), true);
			// Locator
			view.setUint32(56, 0x07064b50, true);
			view.setUint32(60, 0, true);
			view.setBigUint64(64, BigInt(zip64Offset), true);
			view.setUint32(72, 1, true);
			await this.#write(record);
		}

		const end = new Uint8Array(22);
		const view = new DataView(end.buffer);
		view.setUint32(0, 0x06054b50, true);
		view.setUint16(4, 0, true);
		view.setUint16(6, 0, true);
		view.setUint16(8, Math.min(count, MAX_16), true);
		view.setUint16(10, Math.min(count, MAX_16), true);
		view.setUint32(12, Math.min(directorySize, MAX_32), true);
		view.setUint32(16, Math.min(directoryOffset, MAX_32), true);
		view.setUint16(20, 0, true);
		await this.#write(end);
		return this.#offset;
	}
}

export type ZipEntry = {
	name: string;
	/** 0 = stored, 8 = deflate. */
	method: number;
	compressedSize: number;
	size: number;
	offset: number;
};

async function bytesOf(file: ByteSource, start: number, end: number) {
	return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

/** Lists the entries of a zip without reading its contents. */
export async function readZipEntries(
	file: ByteSource,
): Promise<ZipEntry[]> {
	const tailStart = Math.max(0, file.size - (22 + MAX_16 + 20));
	const tail = await bytesOf(file, tailStart, file.size);
	const tailView = new DataView(tail.buffer);
	let end = -1;
	for (let at = tail.length - 22; at >= 0; at -= 1)
		if (tailView.getUint32(at, true) === 0x06054b50) {
			end = at;
			break;
		}
	if (end < 0) throw new Error("El archivo no es un zip válido");

	let count = tailView.getUint16(end + 10, true);
	let directorySize = tailView.getUint32(end + 12, true);
	let directoryOffset = tailView.getUint32(end + 16, true);
	if (
		(count === MAX_16 ||
			directorySize === MAX_32 ||
			directoryOffset === MAX_32) &&
		end >= 20 &&
		tailView.getUint32(end - 20, true) === 0x07064b50
	) {
		const zip64Offset = Number(tailView.getBigUint64(end - 12, true));
		const record = await bytesOf(file, zip64Offset, zip64Offset + 56);
		const view = new DataView(record.buffer);
		if (record.length === 56 && view.getUint32(0, true) === 0x06064b50) {
			count = Number(view.getBigUint64(32, true));
			directorySize = Number(view.getBigUint64(40, true));
			directoryOffset = Number(view.getBigUint64(48, true));
		}
	}

	const directory = await bytesOf(
		file,
		directoryOffset,
		directoryOffset + directorySize,
	);
	const view = new DataView(directory.buffer);
	const entries: ZipEntry[] = [];
	let at = 0;
	for (let index = 0; index < count; index += 1) {
		if (
			at + 46 > directory.length ||
			view.getUint32(at, true) !== 0x02014b50
		)
			break;
		const method = view.getUint16(at + 10, true);
		let compressedSize = view.getUint32(at + 20, true);
		let size = view.getUint32(at + 24, true);
		const nameLength = view.getUint16(at + 28, true);
		const extraLength = view.getUint16(at + 30, true);
		const commentLength = view.getUint16(at + 32, true);
		let offset = view.getUint32(at + 42, true);
		const name = decoder.decode(
			directory.subarray(at + 46, at + 46 + nameLength),
		);

		// zip64 extra: only the fields that overflowed, in this fixed order.
		let extra = at + 46 + nameLength;
		const extraEnd = extra + extraLength;
		while (extra + 4 <= extraEnd) {
			const id = view.getUint16(extra, true);
			const length = view.getUint16(extra + 2, true);
			if (id === 0x0001) {
				let field = extra + 4;
				if (size === MAX_32 && field + 8 <= extraEnd) {
					size = Number(view.getBigUint64(field, true));
					field += 8;
				}
				if (compressedSize === MAX_32 && field + 8 <= extraEnd) {
					compressedSize = Number(view.getBigUint64(field, true));
					field += 8;
				}
				if (offset === MAX_32 && field + 8 <= extraEnd)
					offset = Number(view.getBigUint64(field, true));
			}
			extra += 4 + length;
		}

		entries.push({ name, method, compressedSize, size, offset });
		at = extraEnd + commentLength;
	}
	return entries;
}

/** The contents of one entry, read lazily from the zip file. */
export async function zipEntryBlob(
	file: Blob,
	entry: ZipEntry,
	type = "",
): Promise<Blob> {
	const header = await bytesOf(file, entry.offset, entry.offset + 30);
	const view = new DataView(header.buffer);
	if (header.length < 30 || view.getUint32(0, true) !== 0x04034b50)
		throw new Error(`"${entry.name}" está dañado dentro del zip`);
	const start =
		entry.offset + 30 + view.getUint16(26, true) + view.getUint16(28, true);
	const raw = file.slice(start, start + entry.compressedSize, type);
	if (entry.method === 0) return raw;
	if (entry.method === 8) {
		const inflated = await new Response(
			raw.stream().pipeThrough(new DecompressionStream("deflate-raw")),
		).blob();
		return new Blob([inflated], { type });
	}
	throw new Error(`"${entry.name}" usa una compresión no soportada`);
}

/** Like `zipEntryBlob`, for any byte source; keeps stored entries lazy. */
export async function zipEntrySource(
	file: ByteSource,
	entry: ZipEntry,
): Promise<ByteSource> {
	const header = await bytesOf(file, entry.offset, entry.offset + 30);
	const view = new DataView(header.buffer);
	if (header.length < 30 || view.getUint32(0, true) !== 0x04034b50)
		throw new Error(`"${entry.name}" está dañado dentro del zip`);
	const start =
		entry.offset + 30 + view.getUint16(26, true) + view.getUint16(28, true);
	const raw = file.slice(start, start + entry.compressedSize);
	if (entry.method === 0) return raw;
	if (entry.method === 8)
		return await new Response(
			new Blob([await raw.arrayBuffer()])
				.stream()
				.pipeThrough(new DecompressionStream("deflate-raw")),
		).blob();
	throw new Error(`"${entry.name}" usa una compresión no soportada`);
}

export async function zipEntryText(file: ByteSource, entry: ZipEntry) {
	return decoder.decode(
		await (await zipEntrySource(file, entry)).arrayBuffer(),
	);
}
