<script lang="ts">
	import { goto } from "$app/navigation";
	import HeartIcon from "phosphor-svelte/lib/HeartIcon";
	import { toast } from "svelte-sonner";

	import QuickFilterButton from "$lib/components/filters/QuickFilterButton.svelte";
	import { gridState } from "$lib/grid/grid-state.svelte";
	import { swipeDecisions } from "$lib/grid/swipe-decisions.svelte";

	function openChooser() {
		const next = swipeDecisions.nextNearestUndecided(gridState.profiles);
		if (next !== null) {
			void goto(`/profile/${next}`, {
				state: { profileOrigin: "browse" },
			});
		} else {
			toast.info("No quedan perfiles por decidir");
		}
	}
</script>

<QuickFilterButton active={false} label="Elegir perfiles" onclick={openChooser}>
	<HeartIcon weight="fill" class="text-primary" />
</QuickFilterButton>
