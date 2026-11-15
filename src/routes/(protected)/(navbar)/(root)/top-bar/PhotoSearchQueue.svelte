<script lang="ts">
	import XIcon from "phosphor-svelte/lib/XIcon";
	import { toast } from "svelte-sonner";

	import { gridState } from "$lib/grid/grid-state.svelte";
	import { visionQueue, type VisionJob } from "$lib/search/vision-queue.svelte";

	const query = $derived(gridState.searchText.trim());
	const busy = $derived(visionQueue.pendingCount > 0);
	// Newest first, so what was just added is right under the button.
	const jobs = $derived([...visionQueue.jobs].reverse());

	function add() {
		const outcome = gridState.queuePhotoSearch();
		if (outcome === "duplicate")
			toast("Esa búsqueda ya está en la cola.");
		else if (outcome === "nothing")
			toast("No hay perfiles cargados a menos de 20 km para revisar.");
		else if (visionQueue.pendingCount > 1)
			toast(`«${query}» agregada a la cola.`);
	}

	function statusOf(job: VisionJob): string {
		const count = job.matches.length;
		const found = `${count} ${count === 1 ? "coincidencia" : "coincidencias"}`;
		if (job.status === "queued") return "En cola";
		if (job.status === "running")
			return `Mirando fotos ${job.done}/${job.total} · ${found}`;
		if (job.status === "error") return "Gemini la rechazó";
		return `Lista · ${found}`;
	}

	function removeLabel(job: VisionJob): string {
		return job.status === "queued" || job.status === "running"
			? `Cancelar la búsqueda ${job.query}`
			: `Quitar la búsqueda ${job.query}`;
	}
</script>

<button
	type="button"
	disabled={query === "" || visionQueue.isPending(query)}
	class="self-start rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
	onclick={add}
>
	{busy ? "➕ Agregar a la cola (fotos, 20 km)" : "🔍 Buscar en fotos (20 km)"}
</button>

{#if jobs.length > 0}
	<ul class="flex flex-col gap-1">
		{#each jobs as job (job.id)}
			{@const pending = job.status === "queued" || job.status === "running"}
			<li class="flex items-center gap-2 rounded-xl bg-card px-3 py-1.5">
				{#if job.status === "running"}
					<span
						class="size-3.5 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-accent"
					></span>
				{:else}
					<span class="w-3.5 shrink-0 text-center text-xs">
						{job.status === "queued"
							? "⏳"
							: job.status === "error"
								? "⚠️"
								: "✅"}
					</span>
				{/if}
				<button
					type="button"
					class="flex min-w-0 flex-1 flex-col items-start text-left"
					aria-label="Ver los resultados de {job.query}"
					onclick={() => (gridState.searchText = job.query)}
				>
					<span class="w-full truncate text-xs font-semibold">
						{job.query}
					</span>
					<span class="text-2xs text-muted-foreground">
						{statusOf(job)}{job.failed && job.status !== "error"
							? " · algunas fotos no se pudieron analizar"
							: ""}
					</span>
				</button>
				{#if query.toLocaleLowerCase() !== job.query.toLocaleLowerCase()}
					<button
						type="button"
						class="shrink-0 rounded-full bg-secondary px-2 py-1 text-2xs font-semibold"
						onclick={() => (gridState.searchText = job.query)}
					>
						Ver
					</button>
				{/if}
				<button
					type="button"
					aria-label={removeLabel(job)}
					title={pending ? "Cancelar" : "Quitar"}
					class="flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-input/30"
					onclick={() => visionQueue.remove(job.id)}
				>
					<XIcon weight="bold" class="size-3.5" />
				</button>
			</li>
		{/each}
	</ul>
	{#if busy}
		<p class="text-2xs text-muted-foreground">
			Podés seguir usando la app o salir: la búsqueda sigue en segundo
			plano y te avisa cuando termina.
		</p>
	{/if}
{/if}
