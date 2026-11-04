<script lang="ts">
	import { onMount } from "svelte";

	import { showErrorToast } from "$lib/api/error-toast";
	import {
		type DrawerMedia,
		getAllDrawerMedia,
	} from "$lib/api/messaging/drawer";
	import { sendMessage } from "$lib/api/messaging/messages";
	import {
		addFavoriteUser,
		removeFavoriteUser,
	} from "$lib/api/users/favorites";
	import ApiErrorDisplay from "$lib/components/feedback/ApiErrorDisplay.svelte";
	import PagingSentinel from "$lib/components/shared/PagingSentinel.svelte";
	import { gridState } from "$lib/grid/grid-state.svelte";
	import { swipeDecisions } from "$lib/grid/swipe-decisions.svelte";
	import { proxyMediaUrl } from "$lib/util/media";
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
	let media = $state<DrawerMedia[] | null>(null);
	let selectedMedia = $state<number[]>([]);
	let mediaOpen = $state(false);
	let pendingMessages = $state<
		{ id: number; mediaId?: number; text?: string }[]
	>([]);
	async function openMedia() {
		mediaOpen = !mediaOpen;
		if (!mediaOpen || media !== null) return;
		try {
			media = (await getAllDrawerMedia()).filter((item) =>
				item.contentType.startsWith("image/"),
			);
		} catch (error) {
			showErrorToast({ label: "No se pudieron cargar las fotos", error });
			mediaOpen = false;
		}
	}
	function toggleSelected(id: number) {
		selected = selected.includes(id)
			? selected.filter((value) => value !== id)
			: [...selected, id];
	}
	async function sendSelected() {
		const text = message.trim();
		if (sending) return;
		if (!pendingMessages.length) {
			if ((!text && !selectedMedia.length) || !selected.length) return;
			pendingMessages = selected.flatMap((id) => [
				...(text ? [{ id, text }] : []),
				...selectedMedia.map((mediaId) => ({ id, mediaId })),
			]);
		}
		sending = true;
		const failed: typeof pendingMessages = [];
		for (const item of pendingMessages) {
			try {
				await sendMessage({
					toUserId: item.id,
					message:
						item.mediaId !== undefined
							? { type: "Image", body: { mediaId: item.mediaId } }
							: { type: "Text", body: { text: item.text ?? "" } },
				});
			} catch (error) {
				console.error(error);
				failed.push(item);
			}
		}
		const sent = pendingMessages.length - failed.length;
		pendingMessages = failed;
		sendStatus = failed.length
			? `Se enviaron ${sent} elementos. Fallaron ${failed.length}; podés reintentarlos sin repetir los enviados.`
			: `Se enviaron ${sent} elementos.`;
		if (!failed.length) {
			message = "";
			selectedMedia = [];
		}
		sending = false;
	}
	let columns = $state<number | null>(null);
	let deciding = $state(false);
	async function decide(
		id: number,
		isFavorite: boolean,
		action: "cross" | "favorite",
	) {
		if (deciding) return;
		deciding = true;
		try {
			if (action === "favorite" && !isFavorite) {
				await addFavoriteUser({ profileId: id });
				gridState.setFavorite({ profileId: id, isFavorite: true });
				swipeDecisions.record({ id, action });
			} else if (action === "cross") {
				if (isFavorite) {
					await removeFavoriteUser({ profileId: id });
					gridState.setFavorite({ profileId: id, isFavorite: false });
				}
				swipeDecisions.cross(id);
				swipeDecisions.record({ id, action });
			}
		} catch (error) {
			showErrorToast({ label: "No se pudo guardar la selección", error });
		} finally {
			deciding = false;
		}
	}
	onMount(() => {
		try {
			const saved = Number(
				localStorage.getItem("open-grind-grid-columns"),
			);
			if (Number.isInteger(saved) && saved >= 1 && saved <= 7)
				columns = saved;
		} catch (error) {
			console.error(error);
		}
	});
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
			Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) /
			pinchStart;
		if (scale > 1.2 || scale < 0.8) {
			columns = Math.max(
				1,
				Math.min(7, pinchColumns + (scale > 1 ? -1 : 1)),
			);
			try {
				localStorage.setItem(
					"open-grind-grid-columns",
					String(columns),
				);
			} catch (error) {
				console.error(error);
			}
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
			view.endIndex -
				Math.max(view.startIndex, gridState.profiles.length),
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
			disabled={sending || pendingMessages.length > 0}
		>
			{selecting ? "Cancelar selección" : "Seleccionar perfiles"}
		</button>
		{#if selecting}
			<span>{selected.length} seleccionados</span>
			<textarea
				aria-label="Mensaje para los perfiles seleccionados"
				placeholder="Escribí un mensaje"
				bind:value={message}
				disabled={sending || pendingMessages.length > 0}
				class="w-full rounded-xl bg-card p-3"
			></textarea>
			<button
				type="button"
				class="rounded-full bg-secondary px-4 py-2"
				disabled={sending || pendingMessages.length > 0}
				onclick={openMedia}>Fotos ({selectedMedia.length})</button
			>
			{#if mediaOpen}
				<div
					class="flex w-full flex-wrap gap-2"
					aria-label="Seleccionar fotos"
				>
					{#if media === null}<span>Cargando fotos…</span
						>{:else if media.length === 0}<span
							>No hay fotos cargadas.</span
						>{/if}
					{#each media ?? [] as item (item.id)}
						<button
							type="button"
							class="relative size-20 overflow-hidden rounded-lg"
							aria-label="Seleccionar foto"
							aria-pressed={selectedMedia.includes(item.id)}
							disabled={sending || pendingMessages.length > 0}
							onclick={() =>
								(selectedMedia = selectedMedia.includes(item.id)
									? selectedMedia.filter(
											(id) => id !== item.id,
										)
									: [...selectedMedia, item.id])}
						>
							<img
								src={proxyMediaUrl(item.url, { as: "image" })}
								alt=""
								class="size-full object-cover"
							/>
							{#if selectedMedia.includes(item.id)}<span
									class="absolute inset-0 border-4 border-primary bg-primary/20"
								></span>{/if}
						</button>
					{/each}
				</div>
			{/if}
			<button
				type="button"
				class="rounded-full bg-primary px-4 py-2 text-primary-foreground"
				disabled={sending ||
					(!pendingMessages.length &&
						(!selected.length ||
							(!message.trim() && !selectedMedia.length)))}
				onclick={sendSelected}
				>{sending
					? "Enviando…"
					: pendingMessages.length
						? "Reintentar pendientes"
						: "Enviar mensaje"}</button
			>
			{#if pendingMessages.length > 0}
				<button
					type="button"
					disabled={sending}
					class="rounded-full bg-secondary px-4 py-2"
					onclick={() => {
						pendingMessages = [];
						sendStatus = "Se descartaron los envíos pendientes.";
					}}>Descartar pendientes</button
				>
			{/if}
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
							medias={item.profilePhotosHashes?.map(
								(mediaHash) => ({ mediaHash }),
							) ?? []}
						/>
						{#if columns === 1 && !selecting}
							<div
								class="absolute inset-x-0 bottom-0 flex justify-center gap-8 bg-background/90 p-3"
							>
								<button
									type="button"
									aria-label="Cruz"
									class="rounded-full border-2 border-destructive px-5 py-2 text-destructive"
									disabled={deciding}
									onclick={() =>
										decide(
											item.id,
											item.isFavorite,
											"cross",
										)}>✕</button
								>
								<button
									type="button"
									aria-label="Favorito"
									aria-pressed={item.isFavorite}
									class="rounded-full border-2 border-primary px-5 py-2 text-primary"
									disabled={deciding}
									onclick={() =>
										decide(
											item.id,
											item.isFavorite,
											"favorite",
										)}>{item.isFavorite ? "♥" : "♡"}</button
								>
							</div>
						{/if}
						{#if selecting}
							<button
								type="button"
								class={[
									"absolute inset-0 z-10 border-4",
									{
										"border-primary": selected.includes(
											item.id,
										),
										"border-transparent":
											!selected.includes(item.id),
									},
								]}
								aria-label={`Seleccionar ${item.displayName ?? "perfil"}`}
								aria-pressed={selected.includes(item.id)}
								disabled={sending || pendingMessages.length > 0}
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
