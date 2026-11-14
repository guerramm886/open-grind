<script lang="ts">
	import { toast } from "svelte-sonner";

	import { showErrorToast } from "$lib/api/error-toast";
	import { getMyAlbums, shareAlbum } from "$lib/api/messaging/albums";
	import {
		addMediaToDrawer,
		chatMediaFailureMessage,
	} from "$lib/api/messaging/chat-media";
	import { getAllDrawerMedia } from "$lib/api/messaging/drawer";
	import { getConversations } from "$lib/chat/conversations-context.svelte";
	import { greeting } from "$lib/chat/greeting.svelte";
	import { albumDisplayName } from "$lib/components/album/album";
	import { Button } from "$lib/components/ui/button";
	import { draftFromMessage } from "$lib/model/messaging/messages";
	import { pickMultipleMedia } from "$lib/platform/media-picker";
	import { proxyMediaUrl } from "$lib/util/media";
	import type { DrawerMedia } from "$lib/api/messaging/drawer";
	import type { MyAlbum } from "$lib/model/messaging/albums";
	import { mediaMessageDraft } from "./attachments/media/media-messages";
	import { getMessageComposerContext } from "./message-composer-context.svelte";

	let { ref = $bindable(null) }: { ref?: HTMLElement | null } = $props();

	const composer = getMessageComposerContext();

	let configOpen = $state(false);
	let draft = $state("");
	let draftPhrases = $state<string[]>([]);
	let draftAlbumId = $state<number | null>(null);
	let draftWrap = $state(false);
	let draftPhotos = $state<DrawerMedia[]>([]);
	let addingPhoto = $state(false);
	let showDrawer = $state(false);
	let drawerMedia = $state<DrawerMedia[] | null>(null);
	let loadingDrawer = $state(false);
	let myAlbums = $state<MyAlbum[]>([]);
	let sending = $state(false);
	let pressTimer: ReturnType<typeof setTimeout> | null = null;
	let longPressed = false;

	function openConfig() {
		draft = greeting.message;
		draftPhrases =
			greeting.phrases.length > 0 ? [...greeting.phrases] : [""];
		draftAlbumId = greeting.albumId;
		draftWrap = greeting.phrasesWrap;
		draftPhotos = [...greeting.photos];
		showDrawer = false;
		configOpen = true;
		void getMyAlbums()
			.then((res) => {
				myAlbums = res.albums.filter((album) => album.isShareable);
			})
			.catch((error) => console.error(error));
	}

	function saveConfig() {
		greeting.save(draft.trim());
		greeting.savePhrases(draftPhrases);
		greeting.saveAlbum(draftAlbumId);
		greeting.saveWrap(draftWrap);
		greeting.savePhotos(draftPhotos);
		configOpen = false;
	}

	async function addGreetingPhotos() {
		if (addingPhoto) return;
		addingPhoto = true;
		try {
			const picked = await pickMultipleMedia("media");
			for (const item of picked) {
				try {
					draftPhotos = [...draftPhotos, await addMediaToDrawer(item)];
				} catch (error) {
					toast.error(chatMediaFailureMessage(error));
				}
			}
		} catch (error) {
			console.error(error);
		} finally {
			addingPhoto = false;
		}
	}

	// Pick from the photos already uploaded to your account (Grindr's media
	// drawer) — the ones you reuse often — instead of the phone.
	async function toggleDrawerPicker() {
		showDrawer = !showDrawer;
		if (showDrawer && drawerMedia === null) {
			loadingDrawer = true;
			try {
				drawerMedia = await getAllDrawerMedia();
			} catch (error) {
				showErrorToast({
					label: "No se pudieron cargar tus fotos subidas",
					error,
				});
				drawerMedia = [];
			} finally {
				loadingDrawer = false;
			}
		}
	}

	function toggleDrawerPhoto(item: DrawerMedia) {
		if (draftPhotos.some((photo) => photo.id === item.id))
			draftPhotos = draftPhotos.filter((photo) => photo.id !== item.id);
		else draftPhotos = [...draftPhotos, item];
	}

	function targetProfileId(): number | undefined {
		return getConversations().entries.find(
			(entry) => entry.data.conversationId === composer().conversationId,
		)?.data.participants[0]?.profileId;
	}

	async function sendGreeting() {
		const text = greeting.message.trim();
		if (!text || sending || composer().disabled) return;
		sending = true;
		try {
			await composer().sendMessages([
				draftFromMessage({ type: "Text", body: { text } }),
				...greeting.photos.map((item) =>
					mediaMessageDraft({ item, expiring: false }),
				),
			]);
			const albumId = greeting.albumId;
			const profileId = targetProfileId();
			if (albumId !== null && profileId !== undefined) {
				await shareAlbum({ albumId, profileIds: [profileId] }).catch(
					(error: unknown) => console.error(error),
				);
			}
		} catch (error) {
			console.error(error);
			showErrorToast({ label: "No se pudo enviar el saludo", error });
		} finally {
			sending = false;
		}
	}

	function onPointerDown() {
		longPressed = false;
		pressTimer = setTimeout(() => {
			longPressed = true;
			openConfig();
		}, 500);
	}

	function clearTimer() {
		if (pressTimer !== null) {
			clearTimeout(pressTimer);
			pressTimer = null;
		}
	}

	function onPointerUp() {
		clearTimer();
		if (longPressed) return;
		if (greeting.configured) void sendGreeting();
		else openConfig();
	}
</script>

<button
	bind:this={ref}
	type="button"
	aria-label={greeting.configured
		? "Enviar saludo (mantené apretado para editar)"
		: "Configurar saludo"}
	disabled={composer().disabled || sending}
	class="absolute bottom-0 left-0 flex h-11 items-center justify-center rounded-none rounded-s-composer ps-2.75 pe-1.5 text-xl text-muted-foreground disabled:opacity-50"
	onpointerdown={onPointerDown}
	onpointerup={onPointerUp}
	onpointerleave={clearTimer}
	onpointercancel={clearTimer}
>
	👋
</button>

{#if configOpen}
	<div
		class="absolute bottom-full left-0 z-30 mb-2 w-72 max-w-[90vw] rounded-2xl bg-popover p-3 shadow-lg ring-1 ring-border"
		role="dialog"
		aria-label="Primer mensaje configurable"
	>
		<p class="mb-2 text-sm font-semibold">Primer mensaje</p>
		<textarea
			bind:value={draft}
			rows="3"
			placeholder="Hola, ¿cómo estás?"
			class="w-full rounded-xl bg-secondary p-2 text-base text-foreground"
		></textarea>

		<p class="mt-3 mb-1 text-sm font-semibold">Frases frecuentes</p>
		<div class="flex max-h-44 flex-col gap-2 overflow-y-auto">
			{#each draftPhrases as phrase, i (i)}
				<div class="flex items-center gap-1">
					<input
						value={phrase}
						oninput={(event) =>
							(draftPhrases[i] = event.currentTarget.value)}
						placeholder="Escribí una frase"
						class="min-w-0 flex-1 rounded-lg bg-secondary px-2 py-1.5 text-base text-foreground"
					/>
					<button
						type="button"
						aria-label="Quitar frase"
						class="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-input/40"
						onclick={() =>
							(draftPhrases = draftPhrases.toSpliced(i, 1))}
					>
						✕
					</button>
				</div>
			{/each}
		</div>
		<button
			type="button"
			class="mt-1 text-xs font-medium text-accent"
			onclick={() => (draftPhrases = [...draftPhrases, ""])}
		>
			+ Agregar frase
		</button>

		<label class="mt-3 flex items-start gap-2 text-xs font-medium">
			<input
				type="checkbox"
				bind:checked={draftWrap}
				class="mt-0.5 size-4 shrink-0"
			/>
			<span>
				Mostrar las frases en varias líneas (en vez de una sola con
				scroll al costado)
			</span>
		</label>

		<p class="mt-3 mb-1 text-sm font-semibold">
			Enviar un álbum con el saludo
		</p>
		<select
			value={draftAlbumId ?? ""}
			onchange={(event) =>
				(draftAlbumId =
					event.currentTarget.value === ""
						? null
						: Number(event.currentTarget.value))}
			class="w-full rounded-lg bg-secondary px-2 py-1.5 text-base text-foreground"
		>
			<option value="">Ninguno</option>
			{#each myAlbums as album (album.albumId)}
				<option value={album.albumId}>
					{albumDisplayName(album.albumName)}
				</option>
			{/each}
		</select>

		<p class="mt-3 mb-1 text-sm font-semibold">Fotos del saludo</p>
		<div class="flex flex-wrap gap-2">
			{#each draftPhotos as photo (photo.id)}
				<div class="relative size-16 overflow-hidden rounded-lg">
					<img
						src={proxyMediaUrl(photo.url)}
						alt=""
						class="size-full object-cover"
					/>
					<button
						type="button"
						aria-label="Quitar foto"
						class="absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full bg-black/70 text-xs text-white"
						onclick={() =>
							(draftPhotos = draftPhotos.filter(
								(item) => item.id !== photo.id,
							))}
					>
						✕
					</button>
				</div>
			{/each}
			<button
				type="button"
				disabled={addingPhoto}
				aria-label="Agregar foto del teléfono"
				class="flex size-16 items-center justify-center rounded-lg border border-dashed border-border text-2xl text-muted-foreground disabled:opacity-50"
				onclick={() => void addGreetingPhotos()}
			>
				{addingPhoto ? "…" : "+"}
			</button>
		</div>
		<button
			type="button"
			class="mt-1 text-xs font-medium text-accent"
			onclick={() => void toggleDrawerPicker()}
		>
			{showDrawer
				? "Ocultar fotos ya subidas"
				: "Elegir de fotos ya subidas"}
		</button>
		{#if showDrawer}
			{#if loadingDrawer}
				<p class="text-2xs text-muted-foreground">Cargando…</p>
			{:else if (drawerMedia?.length ?? 0) === 0}
				<p class="text-2xs text-muted-foreground">
					No tenés fotos subidas todavía.
				</p>
			{:else}
				<div
					class="mt-1 grid max-h-40 grid-cols-3 gap-1.5 overflow-y-auto"
				>
					{#each drawerMedia ?? [] as item (item.id)}
						{@const selected = draftPhotos.some(
							(photo) => photo.id === item.id,
						)}
						<button
							type="button"
							class={[
								"relative overflow-hidden rounded-md",
								{ "ring-2 ring-accent": selected },
							]}
							onclick={() => toggleDrawerPhoto(item)}
						>
							<img
								src={proxyMediaUrl(item.url)}
								alt=""
								class="aspect-square w-full object-cover"
							/>
							{#if selected}
								<span
									class="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-accent text-2xs text-accent-foreground"
								>
									✓
								</span>
							{/if}
						</button>
					{/each}
				</div>
			{/if}
		{/if}

		<div class="mt-3 flex justify-end gap-2">
			<Button
				variant="secondary"
				size="sm"
				onclick={() => (configOpen = false)}
			>
				Cancelar
			</Button>
			<Button size="sm" onclick={saveConfig}>Guardar</Button>
		</div>
	</div>
{/if}
