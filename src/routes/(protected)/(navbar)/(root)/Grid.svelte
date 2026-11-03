<script lang="ts">
	import { sendMessage } from "$lib/api/messaging/messages";
	import ApiErrorDisplay from "$lib/components/feedback/ApiErrorDisplay.svelte";
	import PagingSentinel from "$lib/components/shared/PagingSentinel.svelte";
	import { gridState } from "$lib/grid/grid-state.svelte";
	import { virtualGrid } from "$lib/util/virtual-grid.svelte";
	import EmptyGrid from "./EmptyGrid.svelte";
	import GridCellSkeleton from "./GridCellSkeleton.svelte";
	import GridProfileMiniCard from "./GridProfileMiniCard.svelte";

	const PAGE_SKELETONS = 20;

	let { geohash }: { geohash: string } = $props();

	let gridElement: HTMLElement | null = $state(null);
	let selecting = $state(false);
	let selected = $state<number[]>([]);
	let message = $state("");
	let sending = $state(false);
	let sendStatus = $state("");
	function toggleSelected(id: number) {
		selected = selected.includes(id)
			? selected.filter((value) => value !== id)
			: [...selected, id];
	}
	async function sendSelected() {
		const text = message.trim();
		if (!text || !selected.length || sending) return;
		sending = true;
		const failed: number[] = [];
		for (const id of selected) {
			try {
				await sendMessage({
					toUserId: id,
					message: { type: "Text", body: { text } },
				});
			} catch (error) {
				console.error(error);
				failed.push(id);
			}
		}
		const sent = selected.length - failed.length;
		selected = failed;
		sendStatus = failed.length
			? `Enviado a ${sent}. Falló para ${failed.length}; podés volver a intentar.`
			: `Enviado a ${sent} perfiles.`;
		if (!failed.length) message = "";
		sending = false;
	}
	let columns = $state<number | null>(null);
	let pinchStart = 0;
	let pinchColumns = 0;
	function touchStart(event: TouchEvent) {
		if (event.touches.length !== 2 || !gridElement) return;
		const [a, b] = Array.from(event.touches);
		if (!a || !b) return;
		pinchStart = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
		pinchColumns = getComputedStyle(gridElement)
			.gridTemplateColumns.trim()
			.split(/\s+/).length;
	}
	function touchMove(event: TouchEvent) {
		if (!pinchStart || event.touches.length !== 2) return;
		const [a, b] = Array.from(event.touches);
		if (!a || !b) return;
		const scale =
			Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinchStart;
		if (scale > 1.2 || scale < 0.8) {
			columns = Math.max(2, Math.min(7, pinchColumns + (scale > 1 ? -1 : 1)));
			pinchStart = 0;
		}
	}

	const pendingSkeletons = $derived(
		gridState.paging.running ? PAGE_SKELETONS : 0,
	);
	const view = virtualGrid({
		grid: () => gridElement,
		count: () => gridState.profiles.length + pendingSkeletons,
	});
	const visibleProfiles = $derived(
		gridState.profiles.slice(view.startIndex, view.endIndex),
	);
	const visibleSkeletons = $derived(
		Math.max(
			0,
			view.endIndex - Math.max(view.startIndex, gridState.profiles.length),
		),
	);

	$effect.pre(() => {
		gridState.load(geohash);
	});

	$effect(() => gridState.attachView());
</script>

<div class="relative flex flex-1 flex-col">
	<div class="flex flex-wrap items-center gap-2 p-3">
		<button
			type="button"
			class="rounded-full bg-secondary px-4 py-2"
			onclick={() => {
				selecting = !selecting;
				if (!selecting) selected = [];
			}}
			disabled={sending}
		>
			{selecting ? "Cancelar selección" : "Seleccionar perfiles"}
		</button>
		{#if selecting}
			<span>{selected.length} seleccionados</span>
			<textarea
				aria-label="Mensaje para los perfiles seleccionados"
				placeholder="Escribí un mensaje"
				bind:value={message}
				class="w-full rounded-xl bg-card p-3"
			></textarea>
			<button
				type="button"
				class="rounded-full bg-primary px-4 py-2 text-primary-foreground"
				disabled={sending || !selected.length || !message.trim()}
				onclick={sendSelected}
				>{sending ? "Enviando…" : "Enviar mensaje"}</button
			>
		{/if}
		{#if sendStatus}<p role="status">{sendStatus}</p>{/if}
	</div>
	<div
		bind:this={gridElement}
		data-slot="grid-cells"
		role="group"
		aria-label="Cuadrícula de perfiles"
		class="photo-grid"
		style:touch-action="pan-y"
		style:grid-template-columns={columns === null
			? undefined
			: `repeat(${columns}, minmax(0, 1fr))`}
		ontouchstart={touchStart}
		ontouchmove={touchMove}
		ontouchend={() => (pinchStart = 0)}
		style:padding-top="{view.paddingTopPx}px"
		style:padding-bottom="{view.paddingBottomPx}px"
		data-rows-above={view.hasRowsAbove || undefined}
		data-rows-below={view.hasRowsBelow || undefined}
	>
		{#if gridState.loading && gridState.profiles.length === 0}
			{#each Array.from({ length: PAGE_SKELETONS })}
				<GridCellSkeleton />
			{/each}
		{:else if gridState.error && gridState.profiles.length === 0}
			<div class="col-span-full flex p-4">
				<ApiErrorDisplay
					error={gridState.error}
					onRetry={() => gridState.retry()}
					class="m-auto"
				/>
			</div>
		{:else}
			{#if gridState.profiles.length === 0}
				<EmptyGrid />
			{/if}
			{#each visibleProfiles as item (item.id)}
				{#if item.type === "rendered"}
					<div class="relative">
						<GridProfileMiniCard
							id={item.id}
							displayName={item.displayName}
							distance={item.distance}
							unread={item.unread}
							onlineUntil={item.onlineUntil}
							isFavorite={item.isFavorite}
							isVisiting={item.isVisiting}
							hadRecentChat={item.hasChattedInLast24Hrs}
							medias={item.profilePhotosHashes?.map((mediaHash) => ({
								mediaHash,
							})) ?? []}
						/>
						{#if selecting}
							<button
								type="button"
								class={[
									"absolute inset-0 z-10 border-4",
									{
										"border-primary": selected.includes(item.id),
										"border-transparent": !selected.includes(item.id),
									},
								]}
								aria-label={`Seleccionar ${item.displayName ?? "perfil"}`}
								aria-pressed={selected.includes(item.id)}
								onclick={() => toggleSelected(item.id)}
							></button>
						{/if}
					</div>
				{:else}
					<GridCellSkeleton
						onVisible={() => {
							gridState
								.resolveProfile(item.id)
								.catch((error) => console.error(error));
						}}
					/>
				{/if}
			{/each}
			{#each Array.from({ length: visibleSkeletons })}
				<GridCellSkeleton />
			{/each}
		{/if}
	</div>
	<div role="status" class="sr-only">
		{gridState.paging.running
			? "Loading more profiles"
			: gridState.paging.failure
				? "Failed to load more profiles"
				: ""}
	</div>
	{#if gridState.nextPage !== 0 && gridState.nextPage !== null}
		{#if gridState.paging.failure}
			<ApiErrorDisplay
				error={gridState.paging.failure}
				onRetry={() => gridState.paging.retry()}
			/>
		{/if}
		<PagingSentinel
			paging={gridState.paging}
			class="pointer-events-none absolute inset-x-0 bottom-0 h-px"
		/>
	{/if}
</div>
