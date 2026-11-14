<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import ArrowCounterClockwiseIcon from "phosphor-svelte/lib/ArrowCounterClockwiseIcon";
	import StarIcon from "phosphor-svelte/lib/StarIcon";
	import XIcon from "phosphor-svelte/lib/XIcon";

	import { showErrorToast } from "$lib/api/error-toast";
	import {
		addFavoriteUser,
		removeFavoriteUser,
	} from "$lib/api/users/favorites";
	import { gridState } from "$lib/grid/grid-state.svelte";
	import { swipeDecisions } from "$lib/grid/swipe-decisions.svelte";
	import { canGoBack, returnTo } from "$lib/util/history";

	let {
		profileId,
		isFavorite,
		onFavorite,
		onNavigate,
	}: {
		profileId: number;
		isFavorite: boolean;
		onFavorite: (isFavorite: boolean) => void;
		onNavigate: (profileId: number) => void;
	} = $props();

	let busy = $state(false);

	const crossed = $derived(swipeDecisions.isNope(profileId));

	function goToProfile(id: number) {
		onNavigate(id);
	}

	// Where to go after crossing. From a chat, back to the chat list; from
	// Browse, on to the next profile (or the grid when none are left); from
	// anywhere else (Right Now, Visitas, Recibidos…), back to that list.
	function navigateAfterDecision(next: number | null) {
		const origin = page.state.profileOrigin;
		if (origin === "chat") {
			returnTo("/chat");
			return;
		}
		if (origin !== "browse") {
			if (canGoBack()) history.back();
			else void goto("/", { replaceState: true });
			return;
		}
		if (next !== null) goToProfile(next);
		else void goto("/");
	}

	// The next profile to decide, worked out BEFORE we change anything (a cross
	// removes the current one from the list, which would lose our place).
	function goNext() {
		const next = swipeDecisions.nextUndecidedAfter(
			gridState.profiles,
			profileId,
		);
		navigateAfterDecision(next);
	}

	// The star is Grindr's real favorite. It only toggles: it never moves on to
	// another profile (same as the star in Recibidos).
	async function favorite() {
		if (busy) return;
		busy = true;
		try {
			if (isFavorite) {
				await removeFavoriteUser({ profileId });
				onFavorite(false);
			} else {
				await addFavoriteUser({ profileId });
				onFavorite(true);
				swipeDecisions.record({ id: profileId, action: "favorite" });
			}
		} catch (error) {
			console.error(error);
			showErrorToast({
				label: isFavorite
					? "No se pudo quitar de favoritos"
					: "No se pudo marcar como favorito",
				error,
			});
		} finally {
			busy = false;
		}
	}

	async function cross() {
		if (busy) return;
		if (crossed) {
			swipeDecisions.uncross(profileId);
			if (!isFavorite) goNext();
			return;
		}
		const next = swipeDecisions.nextUndecidedAfter(
			gridState.profiles,
			profileId,
		);
		if (isFavorite) {
			busy = true;
			try {
				await removeFavoriteUser({ profileId });
				onFavorite(false);
			} catch (error) {
				console.error(error);
				showErrorToast({ label: "No se pudo quitar de favoritos", error });
				busy = false;
				return;
			}
			busy = false;
		}
		swipeDecisions.cross(profileId);
		swipeDecisions.record({ id: profileId, action: "cross" });
		navigateAfterDecision(next);
	}

	// Go back to the last profile acted on and undo that action, so it can be
	// decided again.
	async function undo() {
		const last = swipeDecisions.undo();
		if (last === null) return;
		if (last.action === "cross") {
			swipeDecisions.uncross(last.id);
		} else {
			try {
				await removeFavoriteUser({ profileId: last.id });
				gridState.setFavorite({ profileId: last.id, isFavorite: false });
			} catch (error) {
				console.error(error);
			}
		}
		goToProfile(last.id);
	}
</script>

<div class="flex flex-row-reverse items-center justify-center gap-4 bg-background px-4 py-3">
	<button
		type="button"
		aria-label={isFavorite ? "Quitar de favoritos" : "Agregar a favoritos"}
		disabled={busy}
		class={[
			"pointer-events-auto flex size-13 items-center justify-center rounded-full backdrop-blur-sm transition active:scale-90",
			isFavorite
				? "bg-primary text-primary-foreground neon-glow"
				: "border-2 border-primary/70 bg-card/70 text-primary",
		]}
		onclick={favorite}
	>
		<StarIcon weight={isFavorite ? "fill" : "bold"} class="size-6" />
	</button>
	<button
		type="button"
		aria-label="Volver atrás"
		disabled={!swipeDecisions.canUndo}
		class="pointer-events-auto flex size-10 items-center justify-center rounded-full bg-card/70 text-secondary-foreground backdrop-blur-sm transition active:scale-90 disabled:opacity-40"
		onclick={undo}
	>
		<ArrowCounterClockwiseIcon weight="bold" class="size-5" />
	</button>
	<button
		type="button"
		aria-label={crossed ? "Sacar la cruz" : "Cruz"}
		disabled={busy}
		class={[
			"pointer-events-auto flex size-13 items-center justify-center rounded-full border-2 border-destructive/70 backdrop-blur-sm transition active:scale-90",
			crossed ? "bg-destructive text-white" : "bg-card/70 text-destructive",
		]}
		onclick={cross}
	>
		<XIcon weight={crossed ? "fill" : "bold"} class="size-6" />
	</button>
</div>
