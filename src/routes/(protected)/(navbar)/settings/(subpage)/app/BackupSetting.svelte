<script lang="ts">
	import { backup } from "$lib/backup/backup.svelte";
	import { Button } from "$lib/components/ui/button";
	import { receivedArchive } from "$lib/received/archive.svelte";

	let includeChats = $state(true);
	let picker = $state<HTMLInputElement | null>(null);

	const percent = $derived(
		backup.total > 0 ? Math.round((backup.done / backup.total) * 100) : null,
	);
</script>

<div class="rounded-xl border p-4">
	<p class="text-base font-semibold">Backup</p>
	<p class="mt-1 text-2xs text-muted-foreground">
		Guarda en un archivo .zip las fotos y videos recibidos ({receivedArchive
			.all.length}), los ajustes de la app (notas, frases, saludo,
		descartados, filtros) y una copia de los chats para leer. Queda en
		Descargas → Martins Grindr y se puede abrir con cualquier administrador
		de archivos. Si reinstalás la app, lo restaurás desde acá.
	</p>

	{#if backup.running}
		<div class="mt-3 rounded-lg bg-secondary p-3">
			<p class="text-sm font-semibold">
				{backup.step}
				{#if backup.total > 0}
					· {backup.done}/{backup.total}
				{:else if backup.done > 0}
					· {backup.done}
				{/if}
			</p>
			{#if percent !== null}
				<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-input/40">
					<div
						class="h-full rounded-full bg-primary"
						style="width: {percent}%"
					></div>
				</div>
			{/if}
			<p class="mt-2 text-2xs text-muted-foreground">
				Podés seguir usando la app mientras tanto.
			</p>
			<Button
				size="sm"
				variant="secondary"
				class="mt-2"
				onclick={() => backup.cancel()}
			>
				Cancelar
			</Button>
		</div>
	{:else if backup.pending}
		{@const pending = backup.pending}
		<div class="mt-3 rounded-lg bg-secondary p-3">
			<p class="text-sm font-semibold">¿Restaurar este backup?</p>
			<p class="mt-1 text-2xs text-muted-foreground">
				{pending.createdAt
					? `Creado el ${new Date(pending.createdAt).toLocaleString("es-AR")}. `
					: ""}Tiene {pending.items.length} fotos/videos; {pending.newItems}
				no están en este teléfono y se van a agregar. Los ajustes actuales
				de la app se reemplazan por los del backup. No se borra nada de lo
				recibido que ya tengas.
			</p>
			<div class="mt-2 flex gap-2">
				<Button size="sm" onclick={() => void backup.restore()}>
					Restaurar
				</Button>
				<Button
					size="sm"
					variant="secondary"
					onclick={() => backup.discardPending()}
				>
					Cancelar
				</Button>
			</div>
		</div>
	{:else}
		<label class="mt-3 flex items-center gap-2 text-sm">
			<input type="checkbox" bind:checked={includeChats} class="size-4" />
			Incluir el texto de los chats (tarda más)
		</label>
		<div class="mt-3 flex flex-wrap gap-2">
			<Button
				size="sm"
				onclick={() => void backup.exportAll({ includeChats })}
			>
				Crear backup
			</Button>
			<Button
				size="sm"
				variant="secondary"
				onclick={() => picker?.click()}
			>
				Restaurar backup
			</Button>
		</div>
	{/if}

	{#if backup.lastResult && !backup.running}
		<p class="mt-3 text-2xs text-muted-foreground">{backup.lastResult}</p>
	{/if}

	<input
		bind:this={picker}
		type="file"
		accept=".zip,application/zip"
		class="hidden"
		onchange={(event) => {
			const input = event.currentTarget;
			const file = input.files?.[0];
			input.value = "";
			if (file) void backup.inspect(file);
		}}
	/>
</div>
