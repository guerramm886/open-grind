<script lang="ts">
	import CommandCenterTrigger from "$lib/components/command-center/CommandCenterTrigger.svelte";
	import ProgressiveBlur from "$lib/components/shared/ProgressiveBlur.svelte";
	import { topChrome } from "$lib/util/screen-chrome.svelte";
	import GridFilters from "../GridFilters.svelte";
	import LocationChange from "../LocationChange.svelte";
	import ChooseDeckButton from "./ChooseDeckButton.svelte";
	import QuickFilters from "./QuickFilters.svelte";

	let openFilters = $state({ all: false, age: false, position: false });
</script>

<ProgressiveBlur
	data-fixed-header
	class="fixed top-0 left-0 z-10 w-full"
	bgClass="bg-linear-to-b from-background to-transparent"
	contentClass="flex flex-col pt-fixed-header"
	direction="topToBottom"
	{@attach topChrome}
>
	<div class="flex items-start gap-0.5 p-4 pt-0">
		<ChooseDeckButton />
		<div
			data-scroll-intent="x"
			class="scrollbar-thin flex min-w-0 flex-1 gap-0.5 overflow-x-auto"
		>
			<LocationChange />
			<QuickFilters bind:openFilters />
			<CommandCenterTrigger />
		</div>
	</div>
</ProgressiveBlur>
<GridFilters bind:open={openFilters.all} />
