<script lang="ts">
	import ArrowLeftIcon from "phosphor-svelte/lib/ArrowLeftIcon";
	import BookmarksSimpleIcon from "phosphor-svelte/lib/BookmarksSimpleIcon";

	import ProfileMiniCard from "$lib/components/profile/ProfileMiniCard.svelte";
	import ProgressiveBlur from "$lib/components/shared/ProgressiveBlur.svelte";
	import { receivedArchive } from "$lib/received/archive.svelte";
	import { topChrome } from "$lib/util/screen-chrome.svelte";

	let query = $state("");

	const people = $derived(receivedArchive.savedPeople());
	const shown = $derived(
		query.trim() === ""
			? people
			: people.filter((p) =>
					(p.name ?? "").toLowerCase().includes(query.trim().toLowerCase()),
				),
	);
</script>

<ProgressiveBlur
	direction="topToBottom"
	tag="nav"
	aria-label="Guardados"
	data-fixed-header
	class="fixed top-0 left-0 z-10 w-full px-4 pt-fixed-header pb-2"
	bgClass="bg-linear-to-b from-background to-transparent"
	contentClass="flex flex-col gap-2 w-full max-w-120 mx-auto"
	{@attach topChrome}
>
	<div class="flex h-10 items-center gap-2">
		<a
			href="/received"
			aria-label="Volver"
			class="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-input/30"
		>
			<ArrowLeftIcon class="size-5" />
		</a>
		<BookmarksSimpleIcon weight="fill" class="size-5 text-accent" />
		<h1 class="text-base font-semibold">Guardados</h1>
	</div>
	<input
		bind:value={query}
		placeholder="Buscar persona…"
		class="w-full rounded-full bg-secondary px-4 py-2 text-base text-foreground"
	/>
</ProgressiveBlur>

<main class="screen-nav-host">
	<div class="pull-scroller">
		<div
			class="@container/photo-grid mx-auto mt-14 min-h-overscrollable flex w-full max-w-120 flex-col gap-3 px-4 pt-header-clear-16 pb-nav-clear"
		>
			{#if shown.length === 0}
				<p class="py-8 text-center text-sm text-muted-foreground">
					{people.length === 0
						? "Todavía no guardaste contenido de nadie."
						: "Nadie coincide con la búsqueda."}
				</p>
			{:else}
				<div class="photo-grid">
					{#each shown as person (person.conversationId)}
						<ProfileMiniCard
							mediaHash={person.mediaHash}
							displayName={person.name}
							href="/received/{person.conversationId}"
						>
							{#snippet overlay()}
								<div
									class="absolute right-1.5 bottom-1.5 z-1 flex items-center gap-0.5 rounded-full bg-black/75 px-1.5 py-0.5 text-2xs font-semibold text-white"
								>
									<BookmarksSimpleIcon weight="bold" class="size-3" />
									{person.count}
								</div>
							{/snippet}
						</ProfileMiniCard>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</main>
