<script lang="ts">
	// Star, undo and cross at the top of a chat, the same three as on a
	// profile and in Recibidos.
	import ArrowCounterClockwiseIcon from "phosphor-svelte/lib/ArrowCounterClockwiseIcon";
	import StarIcon from "phosphor-svelte/lib/StarIcon";
	import XIcon from "phosphor-svelte/lib/XIcon";
	import { toast } from "svelte-sonner";

	import { showErrorToast } from "$lib/api/error-toast";
	import {
		addFavoriteUser,
		removeFavoriteUser,
	} from "$lib/api/users/favorites";
	import { mergeProfileEditIntoCaches } from "$lib/api/users/profiles";
	import { getConversations } from "$lib/chat/conversations-context.svelte";
	import { swipeDecisions } from "$lib/grid/swipe-decisions.svelte";
	import { receivedArchive } from "$lib/received/archive.svelte";
	import { returnTo } from "$lib/util/history";

	let {
		profileId,
		conversationId,
		name,
	}: { profileId: number; conversationId: string; name: string | null } =
		$props();

	const conversations = getConversations();
	let favoriteOverride = $state<boolean | null>(null);
	const isFavorite = $derived(
		favoriteOverride ??
			conversations.entries.find(
				(entry) => entry.data.participants[0]?.profileId === profileId,
			)?.data.favorite ??
			false,
	);
	const crossed = $derived(swipeDecisions.isNope(profileId));
	const savedCount = $derived(receivedArchive.archivedCount(conversationId));

	let busy = $state(false);
	let confirming = $state(false);

	function setFavorite(value: boolean) {
		favoriteOverride = value;
		mergeProfileEditIntoCaches({
			cacheProfileId: profileId,
			patch: { isFavorite: value },
		});
	}

	async function favorite() {
		if (busy) return;
		busy = true;
		const next = !isFavorite;
		try {
			if (next) {
				await addFavoriteUser({ profileId });
				swipeDecisions.record({ id: profileId, action: "favorite" });
			} else {
				await removeFavoriteUser({ profileId });
			}
			setFavorite(next);
		} catch (error) {
			console.error(error);
			showErrorToast({
				label: next
					? "No se pudo marcar como favorito"
					: "No se pudo quitar de favoritos",
				error,
			});
		} finally {
			busy = false;
		}
	}

	function askCross() {
		if (crossed) {
			swipeDecisions.uncross(profileId);
			toast("Le sacaste la cruz");
			return;
		}
		// Crossing deletes their saved photos for good, so ask first.
		if (savedCount > 0) confirming = true;
		else void cross();
	}

	async function cross() {
		confirming = false;
		if (busy) return;
		if (isFavorite) {
			busy = true;
			try {
				await removeFavoriteUser({ profileId });
				setFavorite(false);
			} catch (error) {
				console.error(error);
				showErrorToast({ label: "No se pudo quitar de favoritos", error });
				busy = false;
				return;
			}
			busy = false;
		}
		if (savedCount === 0)
			toast(`Cruzaste a ${name || "este perfil"}`, {
				action: {
					label: "Deshacer",
					onClick: () => swipeDecisions.uncross(profileId),
				},
			});
		void receivedArchive.forget(conversationId);
		swipeDecisions.cross(profileId);
		swipeDecisions.record({ id: profileId, action: "cross" });
		returnTo("/chat");
	}

	// Undo the last cross or star, wherever it was made.
	async function undo() {
		const last = swipeDecisions.undo();
		if (last === null) return;
		if (last.action === "cross") {
			swipeDecisions.uncross(last.id);
			toast("Deshecha la última cruz");
			return;
		}
		try {
			await removeFavoriteUser({ profileId: last.id });
			mergeProfileEditIntoCaches({
				cacheProfileId: last.id,
				patch: { isFavorite: false },
			});
			if (last.id === profileId) favoriteOverride = false;
			toast("Deshecha la última estrella");
		} catch (error) {
			console.error(error);
			showErrorToast({ label: "No se pudo deshacer", error });
		}
	}
</script>

<div class="flex shrink-0 items-center gap-1">
	<button
		type="button"
		aria-label={isFavorite ? "Quitar de favoritos" : "Agregar a favoritos"}
		disabled={busy}
		class={[
			"flex size-9 items-center justify-center rounded-full transition active:scale-90",
			isFavorite
				? "bg-primary text-primary-foreground"
				: "border border-primary/70 text-primary",
		]}
		onclick={favorite}
	>
		<StarIcon weight={isFavorite ? "fill" : "bold"} class="size-5" />
	</button>
	<button
		type="button"
		aria-label="Deshacer"
		disabled={!swipeDecisions.canUndo}
		class="flex size-8 items-center justify-center rounded-full text-secondary-foreground transition active:scale-90 disabled:opacity-40"
		onclick={() => void undo()}
	>
		<ArrowCounterClockwiseIcon weight="bold" class="size-4" />
	</button>
	<button
		type="button"
		aria-label={crossed ? "Sacar la cruz" : "Cruz"}
		disabled={busy}
		class={[
			"flex size-9 items-center justify-center rounded-full border border-destructive/70 transition active:scale-90",
			crossed ? "bg-destructive text-white" : "text-destructive",
		]}
		onclick={askCross}
	>
		<XIcon weight={crossed ? "fill" : "bold"} class="size-5" />
	</button>
</div>

{#if confirming}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
		role="dialog"
		aria-modal="true"
	>
		<div class="w-full max-w-sm rounded-2xl bg-popover p-4 text-sm">
			<p class="font-semibold">¿Cruzar a {name || "este perfil"}?</p>
			<p class="mt-1 text-muted-foreground">
				Se borran las {savedCount} fotos/videos que guardaste de esta persona.
				No se puede deshacer.
			</p>
			<div class="mt-3 flex justify-end gap-2">
				<button
					type="button"
					class="rounded-full bg-secondary px-4 py-1.5"
					onclick={() => (confirming = false)}
				>
					Cancelar
				</button>
				<button
					type="button"
					class="rounded-full bg-destructive px-4 py-1.5 text-white"
					onclick={() => void cross()}
				>
					Cruzar
				</button>
			</div>
		</div>
	</div>
{/if}
