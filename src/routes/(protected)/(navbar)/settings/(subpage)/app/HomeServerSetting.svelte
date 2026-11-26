<script lang="ts">
	import { DEFAULT_URL, homeServer } from "$lib/backup/home-server.svelte";
	import { Button } from "$lib/components/ui/button";

	let url = $state(homeServer.url);
	let password = $state(homeServer.password);
	const changed = $derived(
		url.trim() !== homeServer.url || password !== homeServer.password,
	);
	const syncing = $derived(
		homeServer.syncPhase === "up" || homeServer.syncPhase === "down",
	);
	const percent = $derived(
		homeServer.syncTotal === 0
			? homeServer.syncPhase === "done"
				? 100
				: 0
			: Math.round((homeServer.syncDone / homeServer.syncTotal) * 100),
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

		<!-- Two-way: what the phone has and the server lacks goes up, and what
		     the server has and the phone lacks comes down. -->
		<div class="mt-3 rounded-lg bg-secondary p-3">
			<Button
				size="sm"
				class="w-full"
				disabled={!homeServer.configured ||
					syncing ||
					homeServer.syncPhase === "comparing"}
				onclick={() => void homeServer.fullSync()}
			>
				Sincronizar fotos y videos con Home Assistant
			</Button>
			<p class="mt-2 text-2xs text-muted-foreground">
				Compara lo guardado en el celular con lo de Home Assistant: sube al
				servidor lo que le falta y trae al celular lo que falta acá. No trae
				a las personas que cruzaste.
			</p>
			{#if homeServer.syncPhase === "comparing"}
				<p class="mt-2 text-sm font-semibold">Comparando…</p>
			{:else if homeServer.syncPhase !== null}
				<p class="mt-2 text-sm font-semibold">
					{#if homeServer.syncPhase === "done"}
						Listo · {homeServer.syncDone} de {homeServer.syncTotal}
					{:else}
						{homeServer.syncPhase === "up" ? "Subiendo" : "Trayendo"}… {homeServer.syncDone}
						de {homeServer.syncTotal} · faltan {homeServer.syncTotal -
							homeServer.syncDone}
					{/if}
				</p>
				<div class="mt-2 h-2 overflow-hidden rounded-full bg-input/40">
					<div
						class="h-full rounded-full bg-primary transition-[width]"
						style="width: {percent}%"
					></div>
				</div>
				<p class="mt-1 text-2xs text-muted-foreground">
					Al servidor: {homeServer.upDone}/{homeServer.upTotal} · Al
					celular: {homeServer.downDone}/{homeServer.downTotal}{homeServer.syncFailed >
					0
						? ` · ${homeServer.syncFailed} con error`
						: ""}
				</p>
				{#if syncing}
					<Button
						size="sm"
						variant="secondary"
						class="mt-2"
						onclick={() => homeServer.cancelFullSync()}
					>
						Cancelar
					</Button>
				{/if}
				{#if homeServer.syncProblem}
					<p class="mt-1 text-2xs text-destructive">
						{homeServer.syncProblem}
					</p>
				{/if}
			{/if}
		</div>

		<p class="mt-2 text-2xs text-muted-foreground">
			{#if !homeServer.configured}
				Falta la clave: es la misma que pusiste en el complemento.
			{:else if syncing || homeServer.syncPhase === "comparing"}
				Sincronizando…
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
