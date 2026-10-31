<script lang="ts">
	import { goto } from "$app/navigation";
	import ClockIcon from "phosphor-svelte/lib/ClockIcon";
	import HeartIcon from "phosphor-svelte/lib/HeartIcon";
	import XIcon from "phosphor-svelte/lib/XIcon";

	import { gridState } from "$lib/grid/grid-state.svelte";
	import {
		type SwipeDecision,
		swipeDecisions,
	} from "$lib/grid/swipe-decisions.svelte";

	let { profileId }: { profileId: number } = $props();

	const decided = $derived(swipeDecisions.decision(profileId));

	function advance() {
		const next = swipeDecisions.nextNearestUndecided(
			gridState.profiles,
			profileId,
		);
		if (next !== null) {
			void goto(`/profile/${next}`, {
				state: { profileOrigin: "browse" },
				replaceState: true,
			});
		} else {
			void goto("/");
		}
	}

	function choose(decision: SwipeDecision) {
		swipeDecisions.decide(profileId, decision);
		advance();
	}

	function chooseLater() {
		swipeDecisions.later(profileId);
		advance();
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
			aria-label="No me gusta"
			class={[
				"flex size-14 items-center justify-center rounded-full border-2 border-destructive/70 text-destructive transition active:scale-90",
				{ "bg-destructive/20": decided === "nope" },
			]}
			onclick={() => choose("nope")}
		>
			<XIcon weight="bold" class="size-6" />
		</button>
		<button
			type="button"
			aria-label="Decidir después"
			class="flex size-11 items-center justify-center rounded-full bg-secondary text-secondary-foreground transition active:scale-90"
			onclick={chooseLater}
		>
			<ClockIcon weight="bold" class="size-5" />
		</button>
		<button
			type="button"
			aria-label="Me gusta"
			class={[
				"neon-glow flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground transition active:scale-90",
				{ "ring-2 ring-primary ring-offset-2 ring-offset-card": decided === "like" },
			]}
			onclick={() => choose("like")}
		>
			<HeartIcon weight="fill" class="size-6" />
		</button>
	</div>
</div>
