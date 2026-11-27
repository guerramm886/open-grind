<script lang="ts">
	// Web version only: ask every phone with the app open (on the home wifi)
	// to sync now, and show what this page already has from them.
	import { invoke } from "@tauri-apps/api/core";
	import ArrowsClockwiseIcon from "phosphor-svelte/lib/ArrowsClockwiseIcon";
	import { onDestroy } from "svelte";

	import * as Item from "$lib/components/ui/item";
	import { receivedArchive } from "$lib/received/archive.svelte";

	let requestedAt = $state(0);
	let lastPhone = $state(0);
	let busy = $state(false);
	let problem = $state<string | null>(null);
	let now = $state(Date.now());

	async function readStatus(): Promise<void> {
		try {
			const status = await invoke<{ requested: number; lastPhone: number }>(
				"sync_status",
			);
			lastPhone = status.lastPhone;
			if (requestedAt === 0) requestedAt = status.requested;
		} catch {
			/* shown next time */
		}
	}

	async function syncAll(): Promise<void> {
		busy = true;
		problem = null;
		try {
			requestedAt = await invoke<number>("sync_request_all");
			await receivedArchive.refresh();
		} catch (error) {
			problem = String(error);
		} finally {
			busy = false;
		}
	}

	function ago(time: number): string {
		const minutes = Math.round((now - time) / 60_000);
		if (minutes < 1) return "hace menos de un minuto";
		if (minutes === 1) return "hace 1 minuto";
		if (minutes < 60) return `hace ${minutes} minutos`;
		const hours = Math.round(minutes / 60);
		return hours === 1 ? "hace 1 hora" : `hace ${hours} horas`;
	}

	void readStatus();
	const timer = setInterval(() => {
		now = Date.now();
		void readStatus();
		// While a request is fresh, keep showing what arrives.
		if (now - requestedAt < 3 * 60_000) void receivedArchive.refresh();
	}, 10_000);
	onDestroy(() => clearInterval(timer));

	const waiting = $derived(requestedAt > 0 && lastPhone < requestedAt && now - requestedAt < 3 * 60_000);
</script>

<Item.Root variant="outline" class="flex-col items-stretch gap-3 p-4">
	<Item.Content class="gap-1">
		<Item.Title>Sincronizar con otros dispositivos</Item.Title>
		<Item.Description class="text-wrap">
			Les pide a todos los celulares con la app abierta, en el wifi de tu
			casa, que manden lo que falta acá y traigan lo que les falta. Tarda
			menos de un minuto en empezar.
		</Item.Description>
	</Item.Content>
	<button
		type="button"
		disabled={busy}
		class="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-sky-500/20 text-sm font-medium text-sky-700 active:bg-sky-500/35 disabled:opacity-60 dark:text-sky-300"
		onclick={() => void syncAll()}
	>
		<ArrowsClockwiseIcon weight="bold" class={["size-5", busy && "animate-spin"]} />
		Sincronizar con otros dispositivos
	</button>
	<p class="text-xs text-muted-foreground">
		{#if waiting}
			Pedido enviado. Esperando a los celulares…
		{:else if lastPhone > 0}
			Último celular sincronizado {ago(lastPhone)}.
		{:else}
			Todavía ningún celular se sincronizó desde que arrancó el servidor.
		{/if}
	</p>
	{#if problem}
		<p class="text-xs text-destructive">{problem}</p>
	{/if}
</Item.Root>
