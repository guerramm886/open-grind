// Queue of photo searches (Gemini). Searches run one at a time, survive leaving
// the screen or the app (on Android a foreground service keeps the process
// alive) and resume where they left off if the app gets closed mid-search.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { toast } from "svelte-sonner";

import {
	GEMINI_BATCH,
	geminiMatchBatch,
	type VisionCandidate,
} from "./gemini-search.svelte";

const STORAGE = "vision-queue-v1";
// Finished searches kept around so their results can be reopened.
const KEEP_FINISHED = 8;

export type VisionJobStatus = "queued" | "running" | "done" | "error";

export type VisionJob = {
	id: string;
	query: string;
	status: VisionJobStatus;
	/** Photos still to look at; emptied once the search finishes. */
	candidates: VisionCandidate[];
	done: number;
	total: number;
	matches: number[];
	/** Some photos couldn't be analysed. */
	failed: boolean;
	createdAt: number;
};

function queryKey(query: string): string {
	return query.trim().toLocaleLowerCase();
}

function isPending(job: VisionJob): boolean {
	return job.status === "queued" || job.status === "running";
}

function load(): VisionJob[] {
	try {
		const parsed: unknown = JSON.parse(
			localStorage.getItem(STORAGE) ?? "[]",
		);
		if (!Array.isArray(parsed)) return [];
		return (parsed as VisionJob[]).filter(
			(job) =>
				typeof job?.id === "string" &&
				typeof job.query === "string" &&
				Array.isArray(job.candidates) &&
				Array.isArray(job.matches),
		);
	} catch {
		return [];
	}
}

function keepAlive(command: string, args: Record<string, unknown>): void {
	if (!isTauri()) return;
	void invoke(command, args).catch((error: unknown) =>
		console.error("[vision-queue] keep-alive", error),
	);
}

class VisionQueue {
	jobs = $state.raw<VisionJob[]>(load());
	#pumping = false;

	constructor() {
		// Pick up whatever was pending when the app was last closed.
		if (this.jobs.some(isPending)) queueMicrotask(() => void this.#pump());
	}

	get pendingCount(): number {
		return this.jobs.filter(isPending).length;
	}

	/** Whether a search for this text is already queued or running. */
	isPending(query: string): boolean {
		const key = queryKey(query);
		return this.jobs.some(
			(job) => isPending(job) && queryKey(job.query) === key,
		);
	}

	/** Profile ids matched so far for this text, or null if never searched. */
	matchesFor(query: string): ReadonlySet<number> | null {
		const key = queryKey(query);
		if (key === "") return null;
		const job = this.jobs.find((item) => queryKey(item.query) === key);
		return job ? new Set(job.matches) : null;
	}

	enqueue({
		query,
		candidates,
	}: {
		query: string;
		candidates: VisionCandidate[];
	}): "added" | "duplicate" | "nothing" {
		const text = query.trim();
		if (text === "") return "nothing";
		if (this.isPending(text)) return "duplicate";
		if (candidates.length === 0) return "nothing";
		const key = queryKey(text);
		const job: VisionJob = {
			id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			query: text,
			status: "queued",
			candidates,
			done: 0,
			total: candidates.length,
			matches: [],
			failed: false,
			createdAt: Date.now(),
		};
		// A new search for the same text replaces its old result.
		this.#set([
			...this.jobs.filter((item) => queryKey(item.query) !== key),
			job,
		]);
		void this.#pump();
		return "added";
	}

	/** Cancel a running/queued search, or drop a finished one. */
	remove(id: string): void {
		this.#set(this.jobs.filter((job) => job.id !== id));
	}

	#get(id: string): VisionJob | undefined {
		return this.jobs.find((job) => job.id === id);
	}

	#patch(id: string, patch: Partial<VisionJob>): void {
		this.#set(
			this.jobs.map((job) => (job.id === id ? { ...job, ...patch } : job)),
		);
	}

	#set(jobs: VisionJob[]): void {
		const finished = jobs.filter((job) => !isPending(job));
		const drop = new Set(
			finished
				.slice(0, Math.max(0, finished.length - KEEP_FINISHED))
				.map((job) => job.id),
		);
		this.jobs = jobs.filter((job) => !drop.has(job.id));
		try {
			localStorage.setItem(STORAGE, JSON.stringify(this.jobs));
		} catch {
			/* storage unavailable or full: the queue still works in memory */
		}
	}

	async #pump(): Promise<void> {
		if (this.#pumping) return;
		this.#pumping = true;
		const finished: string[] = [];
		try {
			for (;;) {
				const job =
					this.jobs.find((item) => item.status === "running") ??
					this.jobs.find((item) => item.status === "queued");
				if (!job) break;
				const summary = await this.#run(job.id);
				if (summary) finished.push(summary);
			}
		} finally {
			this.#pumping = false;
			// Only notify outside the app; inside it the toast already told.
			const away =
				typeof document !== "undefined" &&
				document.visibilityState === "hidden";
			keepAlive("search_keepalive_release", {
				doneText: away && finished.length > 0 ? finished.join("\n") : null,
			});
		}
	}

	// Runs one search to the end. Returns a one-line summary when it finished
	// (not when it was cancelled).
	async #run(id: string): Promise<string | null> {
		this.#patch(id, { status: "running" });
		for (;;) {
			const job = this.#get(id);
			if (!job) return null;
			if (job.done >= job.candidates.length) break;
			const waiting = this.pendingCount - 1;
			keepAlive("search_keepalive_hold", {
				text:
					`«${job.query}» · ${job.done}/${job.total}` +
					(waiting > 0 ? ` · ${waiting} en cola` : ""),
			});
			const batch = job.candidates.slice(job.done, job.done + GEMINI_BATCH);
			const result = await geminiMatchBatch({
				query: job.query,
				batch,
				shouldStop: () => !this.#get(id),
			});
			const current = this.#get(id);
			if (!current) return null;
			if (result.fatal) {
				this.#patch(id, { status: "error", failed: true, candidates: [] });
				toast.error(
					`Gemini rechazó la búsqueda «${current.query}». Revisá la clave en Configuración.`,
				);
				return `«${current.query}»: Gemini rechazó la búsqueda`;
			}
			this.#patch(id, {
				done: current.done + batch.length,
				matches: [...new Set([...current.matches, ...result.matches])],
				failed: current.failed || result.failed,
			});
		}
		const job = this.#get(id);
		if (!job) return null;
		this.#patch(id, { status: "done", candidates: [] });
		const count = job.matches.length;
		const summary = `«${job.query}»: ${count} ${count === 1 ? "coincidencia" : "coincidencias"}`;
		toast.success(`Búsqueda en fotos lista · ${summary}`);
		return summary;
	}
}

export const visionQueue = new VisionQueue();
