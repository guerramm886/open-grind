<script lang="ts">
	import BookmarksSimpleIcon from "phosphor-svelte/lib/BookmarksSimpleIcon";
	import HeartIcon from "phosphor-svelte/lib/HeartIcon";
	import ImagesIcon from "phosphor-svelte/lib/ImagesIcon";

	import ProfileMiniCard from "$lib/components/profile/ProfileMiniCard.svelte";
	import ProgressiveBlur from "$lib/components/shared/ProgressiveBlur.svelte";
	import { Button } from "$lib/components/ui/button";
	import { Skeleton } from "$lib/components/ui/skeleton";
	import { untrack } from "svelte";

	import { receivedArchive } from "$lib/received/archive.svelte";
	import { observeIntersection } from "$lib/util/observe-intersection";
	import { topChrome } from "$lib/util/screen-chrome.svelte";
	import { getReceivedPeople } from "./received-people.svelte";

	let { data }: import("./$types").PageProps = $props();

	const people = untrack(() => getReceivedPeople(data.ourProfileId));
	const shown = $derived(people.visible);

	// Remember the chosen sort/filters whenever they change.
	$effect(() => people.savePrefs());
</script>

<ProgressiveBlur
	direction="topToBottom"
	tag="nav"
	aria-label="Recibidos"
	data-fixed-header
	class="fixed top-0 left-0 z-10 w-full px-4 pt-fixed-header pb-2"
	bgClass="bg-linear-to-b from-background to-transparent"
	contentClass="flex flex-col gap-2 w-full max-w-120 mx-auto"
	{@attach topChrome}
>
	<div class="flex h-10 items-center gap-2">
		<ImagesIcon weight="fill" class="size-5 text-accent" />
		<h1 class="text-base font-semibold">Recibidos</h1>
		{#if people.scanning}
			<span
				class="size-4 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-accent"
				title="Buscando quién te envió contenido"
			></span>
		{/if}
		<a
			href="/received/guardados"
			class="ms-auto inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium hover:bg-input/30"
		>
			<BookmarksSimpleIcon weight="fill" class="size-4 text-accent" />
			Guardados
		</a>
	</div>
	<div class="flex flex-wrap items-center gap-2">
		<div class="inline-flex overflow-hidden rounded-full border">
			<button
				type="button"
				class={[
					"px-3 py-1 text-xs font-medium transition-colors",
					people.sort === "recent"
						? "bg-primary text-primary-foreground"
						: "text-muted-foreground",
				]}
				onclick={() => (people.sort = "recent")}
			>
				Reciente
			</button>
			<button
				type="button"
				class={[
					"px-3 py-1 text-xs font-medium transition-colors",
					people.sort === "distance"
						? "bg-primary text-primary-foreground"
						: "text-muted-foreground",
				]}
				onclick={() => (people.sort = "distance")}
			>
				Cercano
			</button>
		</div>
		<Button
			variant="secondary"
			size="sm"
			aria-pressed={people.favoritesOnly}
			class={{
				"bg-primary text-primary-foreground hover:bg-primary/90":
					people.favoritesOnly,
			}}
			onclick={() => (people.favoritesOnly = !people.favoritesOnly)}
		>
			<HeartIcon weight="fill" class="size-3.5" /> Favoritos
		</Button>
		<Button
			variant="secondary"
			size="sm"
			aria-pressed={people.ageFilterOn}
			class={{
				"bg-primary text-primary-foreground hover:bg-primary/90":
					people.ageFilterOn,
			}}
			onclick={() => (people.ageFilterOn = !people.ageFilterOn)}
		>
			Edad
		</Button>
		{#if people.ageFilterOn}
			<div class="flex items-center gap-1 text-xs">
				<input
					type="number"
					min="18"
					max="99"
					bind:value={people.ageMin}
					class="w-14 rounded-md border bg-background px-2 py-1 text-center"
				/>
				<span>–</span>
				<input
					type="number"
					min="18"
					max="99"
					bind:value={people.ageMax}
					class="w-14 rounded-md border bg-background px-2 py-1 text-center"
				/>
			</div>
		{/if}
	</div>
</ProgressiveBlur>

<main class="screen-nav-host">
	<div class="pull-scroller">
		<div
			class="@container/photo-grid mx-auto mt-14 min-h-overscrollable flex w-full max-w-120 flex-col gap-3 px-4 pt-header-clear-16 pb-nav-clear"
		>
			{#if people.scanning && shown.length === 0}
				<div class="photo-grid">
					{#each Array(12)}
						<Skeleton class="aspect-square rounded-none" />
					{/each}
				</div>
			{:else if people.error && shown.length === 0}
				<p class="py-8 text-center text-sm text-muted-foreground">
					No se pudo cargar. <button
						class="underline"
						onclick={() => void people.scanMore()}>Reintentar</button
					>
				</p>
			{:else if shown.length === 0}
				<p class="py-8 text-center text-sm text-muted-foreground">
					{people.ageFilterOn || people.favoritesOnly
						? "Nadie coincide con el filtro."
						: "Todavía nadie te envió fotos, videos ni álbumes."}
				</p>
			{:else}
				<div class="photo-grid">
					{#each shown as person (person.conversationId)}
						{@const saved = receivedArchive.archivedCount(
							person.conversationId,
						)}
						<ProfileMiniCard
							mediaHash={person.mediaHash}
							displayName={person.name}
							age={people.ages[person.profileId] ?? null}
							distance={person.distance}
							isFavorite={person.favorite}
							href="/received/{person.conversationId}"
						>
							{#snippet overlay()}
								{#if saved > 0}
									<div
										class="absolute right-1.5 bottom-1.5 z-1 flex items-center gap-0.5 rounded-full bg-black/75 px-1.5 py-0.5 text-2xs font-semibold text-white"
										title="{saved} guardados"
									>
										<ImagesIcon weight="bold" class="size-3" />
										{saved}
									</div>
								{/if}
							{/snippet}
						</ProfileMiniCard>
					{/each}
				</div>
				{#if people.hasMore}
					<div
						class="h-0"
						use:observeIntersection={{
							handle: () => void people.scanMore(),
							rootMargin: "600px",
						}}
					></div>
				{/if}
			{/if}
		</div>
	</div>
</main>
