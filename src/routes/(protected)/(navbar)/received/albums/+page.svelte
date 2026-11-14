<script lang="ts">
	import ArrowLeftIcon from "phosphor-svelte/lib/ArrowLeftIcon";
	import ImagesSquareIcon from "phosphor-svelte/lib/ImagesSquareIcon";
	import LockSimpleIcon from "phosphor-svelte/lib/LockSimpleIcon";
	import StarIcon from "phosphor-svelte/lib/StarIcon";
	import { toast } from "svelte-sonner";

	import {
		getSharedAlbumsFeed,
		type SharedAlbum,
	} from "$lib/api/messaging/shared-albums-feed";
	import BackLink from "$lib/components/navigation/BackLink.svelte";
	import ProgressiveBlur from "$lib/components/shared/ProgressiveBlur.svelte";
	import { Button } from "$lib/components/ui/button";
	import { Skeleton } from "$lib/components/ui/skeleton";
	import { receivedArchive } from "$lib/received/archive.svelte";
	import {
		archiveSharedAlbum,
		conversationIdWith,
	} from "$lib/received/favorite-albums";
	import { proxyMediaUrl } from "$lib/util/media";
	import { topChrome } from "$lib/util/screen-chrome.svelte";

	let { data }: import("./$types").PageProps = $props();

	let favoritesOnly = $state(true);
	let albums = $state<SharedAlbum[]>([]);
	let loading = $state(true);
	let failed = $state(false);
	let savingAll = $state(false);

	$effect(() => {
		const onlyFavorites = favoritesOnly;
		loading = true;
		failed = false;
		let alive = true;
		void getSharedAlbumsFeed({ favoritesOnly: onlyFavorites })
			.then((list) => {
				if (alive) albums = list;
			})
			.catch((error: unknown) => {
				console.error(error);
				if (alive) failed = true;
			})
			.finally(() => {
				if (alive) loading = false;
			});
		return () => {
			alive = false;
		};
	});

	function conversationOf(album: SharedAlbum): string {
		return conversationIdWith({
			ourProfileId: data.ourProfileId,
			profileId: album.ownerProfileId,
		});
	}

	function savedOf(album: SharedAlbum): number {
		return receivedArchive
			.entriesFor(conversationOf(album))
			.filter((entry) => entry.albumId === album.albumId).length;
	}

	const openCount = $derived(albums.filter((album) => album.viewable).length);

	// Copy every readable album in the list into the app.
	async function saveAll() {
		if (savingAll) return;
		savingAll = true;
		let saved = 0;
		let errors = 0;
		for (const album of albums) {
			try {
				saved += await archiveSharedAlbum({
					album,
					ourProfileId: data.ourProfileId,
				});
			} catch (error) {
				errors += 1;
				console.error(error);
			}
		}
		savingAll = false;
		if (errors > 0)
			toast.error(`Se guardaron ${saved} archivos; fallaron ${errors} álbumes`);
		else if (saved > 0) toast.success(`${saved} archivos nuevos guardados`);
		else toast("Ya estaba todo guardado");
	}
</script>

<ProgressiveBlur
	direction="topToBottom"
	tag="nav"
	aria-label="Álbumes recibidos"
	data-fixed-header
	class="fixed top-0 left-0 z-10 w-full px-4 pt-fixed-header pb-2"
	bgClass="bg-linear-to-b from-background to-transparent"
	contentClass="flex flex-col gap-2 w-full max-w-120 mx-auto"
	{@attach topChrome}
>
	<div class="flex h-10 items-center gap-2">
		<BackLink
			href="/received"
			label="Volver a Recibidos"
			class="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-input/30"
		>
			<ArrowLeftIcon class="size-5" />
		</BackLink>
		<ImagesSquareIcon weight="fill" class="size-5 text-accent" />
		<h1 class="text-base font-semibold">Álbumes recibidos</h1>
	</div>
	<div class="flex flex-wrap items-center gap-2">
		<Button
			variant="secondary"
			size="sm"
			aria-pressed={favoritesOnly}
			class={{
				"bg-primary text-primary-foreground hover:bg-primary/90":
					favoritesOnly,
			}}
			onclick={() => (favoritesOnly = !favoritesOnly)}
		>
			<StarIcon weight="fill" class="size-3.5" /> Solo favoritos
		</Button>
		<Button
			size="sm"
			disabled={savingAll || loading || openCount === 0}
			onclick={() => void saveAll()}
		>
			{savingAll ? "Guardando…" : "Guardar todos en la app"}
		</Button>
	</div>
</ProgressiveBlur>

<main class="screen-nav-host">
	<div class="pull-scroller">
		<div
			class="mx-auto min-h-overscrollable mt-14 flex w-full max-w-120 flex-col gap-2 px-3 pt-header-clear-16 pb-nav-clear"
		>
			{#if loading}
				{#each Array(5)}
					<Skeleton class="h-20 rounded-xl" />
				{/each}
			{:else if failed}
				<p class="py-8 text-center text-sm text-muted-foreground">
					No se pudo cargar la lista de álbumes.
				</p>
			{:else if albums.length === 0}
				<p class="py-8 text-center text-sm text-muted-foreground">
					{favoritesOnly
						? "Ningún favorito te compartió un álbum."
						: "Nadie te compartió un álbum."}
				</p>
			{:else}
				<p class="text-2xs text-muted-foreground">
					{openCount} de {albums.length} se pueden ver. Los que tienen
					candado están bloqueados por el límite de Grindr.
				</p>
				{#each albums as album (album.albumId)}
					{@const saved = savedOf(album)}
					{@const total = album.imageCount + album.videoCount}
					<a
						href="/received/{conversationOf(album)}"
						class="flex items-center gap-3 rounded-xl bg-secondary/40 p-2"
					>
						<div
							class="relative size-16 shrink-0 overflow-hidden rounded-lg bg-stone-700"
						>
							{#if album.coverUrl}
								<img
									src={proxyMediaUrl(album.coverUrl)}
									alt=""
									class="size-full object-cover"
								/>
							{/if}
							{#if !album.viewable}
								<span
									class="absolute inset-0 flex items-center justify-center bg-black/55 text-white"
								>
									<LockSimpleIcon weight="fill" class="size-5" />
								</span>
							{/if}
						</div>
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-semibold">
								{album.ownerName || "Perfil"}
							</p>
							<p class="truncate text-xs text-muted-foreground">
								{album.name || "Álbum"} · {album.imageCount} fotos
								{#if album.videoCount > 0}
									· {album.videoCount} videos
								{/if}
							</p>
							<p class="text-2xs">
								{#if saved > 0}
									<span class="text-green-400">
										{saved}{total > 0 ? ` de ${total}` : ""} guardados
										en la app
									</span>
								{:else if album.viewable}
									<span class="text-yellow-400">Sin guardar</span>
								{:else}
									<span class="text-muted-foreground">
										Bloqueado, nada guardado
									</span>
								{/if}
								{#if album.hasUnseenContent}
									<span class="ms-1 text-accent">· nuevo</span>
								{/if}
							</p>
						</div>
					</a>
				{/each}
			{/if}
		</div>
	</div>
</main>