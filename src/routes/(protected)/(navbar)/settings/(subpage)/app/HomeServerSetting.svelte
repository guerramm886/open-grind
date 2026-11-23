<script lang="ts">
	import { DEFAULT_URL, homeServer } from "$lib/backup/home-server.svelte";
	import { Button } from "$lib/components/ui/button";

	let url = $state(homeServer.url);
	let password = $state(homeServer.password);
	const changed = $derived(
		url.trim() !== homeServer.url || password !== homeServer.password,
	);
</script>

{#if homeServer.available}
	<div class="rounded-xl border p-4">
		<p class="text-base font-semibold">Copia automática en Home Assistant</p>
		<p class="mt-1 text-2xs text-muted-foreground">
			Cada foto y video guardado se copia solo a tu PC de Home Assistant,
			en Medios › Martins Grindr, una carpeta por persona. También se copian
			los ajustes de la app (frases, notas, corazones y estrellas, filtros)
			cada vez que cambian. La clave de Gemini no se manda. Funciona cuando
			el teléfono está en la misma red que esa PC.
		</p>

		<div class="mt-3 flex flex-col gap-2">
			<input
				class="rounded-lg border bg-secondary px-3 py-2 text-sm"
				type="url"
				inputmode="url"
				autocomplete="off"
				placeholder={DEFAULT_URL}
				bind:value={url}
			/>
			<input
				class="rounded-lg border bg-secondary px-3 py-2 text-sm"
				type="password"
				autocomplete="off"
				placeholder="Clave del complemento"
				bind:value={password}
			/>
			<div class="flex gap-2">
				<Button
					size="sm"
					disabled={!changed || password === ""}
					onclick={() => homeServer.configure(url, password)}
				>
					Guardar
				</Button>
				<Button
					size="sm"
					variant="secondary"
					disabled={!homeServer.configured || homeServer.running}
					onclick={() => void homeServer.sync()}
				>
					Copiar ahora
				</Button>
			</div>
		</div>

		<p class="mt-2 text-2xs text-muted-foreground">
			{#if !homeServer.configured}
				Falta la clave: es la misma que pusiste en el complemento.
			{:else if homeServer.running}
				Copiando… {homeServer.sentThisPass} enviados{homeServer.pending > 0
					? `, faltan ${homeServer.pending}`
					: ""}
			{:else if homeServer.lastOk}
				Al día · {new Date(homeServer.lastOk).toLocaleString("es-AR")}
			{:else}
				Esperando la primera copia.
			{/if}
		</p>
		{#if homeServer.problem}
			<p class="mt-1 text-2xs text-destructive">
				No se pudo copiar: {homeServer.problem}
			</p>
		{/if}
	</div>
{/if}
