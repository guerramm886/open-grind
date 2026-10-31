<script lang="ts">
	import { goto } from "$app/navigation";
	import ArrowCounterClockwiseIcon from "phosphor-svelte/lib/ArrowCounterClockwiseIcon";
	import HeartIcon from "phosphor-svelte/lib/HeartIcon";
	import XIcon from "phosphor-svelte/lib/XIcon";

	import { showErrorToast } from "$lib/api/error-toast";
	import {
		addFavoriteUser,
		removeFavoriteUser,
	} from "$lib/api/users/favorites";
	import { gridState } from "$lib/grid/grid-state.svelte";
	import { swipeDecisions } from "$lib/grid/swipe-decisions.svelte";

	let {
		profileId,
		isFavorite,
		onFavorite,
	}: {
		profileId: number;
		isFavorite: boolean;
		onFavorite: (isFavorite: boolean) => void;
	} = $props();

	let busy = $state(false);

	const crossed = $derived(swipeDecisions.isNope(profileId));

	function goToProfile(id: number) {
		void goto(`/profile/${id}`, {
			state: { profileOrigin: "browse" },
			replaceState: true,
		});
	}

	function advance() {
		const next = swipeDecisions.nextNearestUndecided(
			gridState.profiles,
			profileId,
		);
		if (next !== null) goToProfile(next);
		else void goto("/");
	}

	// The heart is Grindr's real favorite, so it also shows as a star in the
	// official app. Marking it moves on to the next nearest profile.
	async function favorite() {
		if (busy) return;
		if (!isFavorite) {
			busy = true;
			try {
				await addFavoriteUser({ profileId });
				onFavorite(true);
				swipeDecisions.record({ id: profileId, action: "favorite" });
			} catch (error) {
				console.error(error);
				showErrorToast({
					label: "No se pudo marcar como favorito",
					error,
				});
				busy = false;
				return;
			}
			busy = false;
		}
		advance();
	}

	async function cross() {
		if (busy) return;
		if (crossed) {
			swipeDecisions.uncross(profileId);
			if (!isFavorite) advance();
			return;
		}
		if (isFavorite) {
			busy = true;
			try {
				await removeFavoriteUser({ profileId });
				onFavorite(false);
			} catch (error) {
				console.error(error);
			}
			busy = false;
		}
		swipeDecisions.cross(profileId);
		swipeDecisions.record({ id: profileId, action: "cross" });
		advance();
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
				gridState.setFavorite({
					profileId: last.id,
					isFavorite: false,
				});
			} catch (error) {
				console.error(error);
			}
		}
		goToProfile(last.id);
	}
</script>

<div
	class="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center pb-[calc(var(--nav-height)+var(--safe-area-bottom)+0.75rem)]"
>
	<div
		class="pointer-events-auto flex items-center gap-4 rounded-full bg-card/85 px-4 py-2 neon-ring backdrop-blur-sm"
	>
		<button
			type="button"
			aria-label={crossed ? "Sacar la cruz" : "Cruz"}
			disabled={busy}
			class={[
				"flex size-14 items-center justify-center rounded-full border-2 border-destructive/70 text-destructive transition active:scale-90",
				{ "bg-destructive text-white": crossed },
			]}
			onclick={cross}
		>
			<XIcon weight="bold" class="size-6" />
		</button>
		<button
			type="button"
			aria-label="Volver atrás"
			disabled={!swipeDecisions.canUndo}
			class="flex size-11 items-center justify-center rounded-full bg-secondary text-secondary-foreground transition active:scale-90 disabled:opacity-40"
			onclick={undo}
		>
			<ArrowCounterClockwiseIcon weight="bold" class="size-5" />
		</button>
		<button
			type="button"
			aria-label={isFavorite ? "Favorito" : "Agregar a favoritos"}
			disabled={busy}
			class={[
				"flex size-14 items-center justify-center rounded-full transition active:scale-90",
				isFavorite
					? "neon-glow bg-primary text-primary-foreground"
					: "border-2 border-primary/70 text-primary",
			]}
			onclick={favorite}
		>
			<HeartIcon weight={isFavorite ? "fill" : "bold"} class="size-6" />
		</button>
	</div>
</div>
