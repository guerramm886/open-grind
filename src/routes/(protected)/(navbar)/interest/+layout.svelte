<script lang="ts">
	import ProgressiveBlur from "$lib/components/shared/ProgressiveBlur.svelte";
	import { topChrome } from "$lib/util/screen-chrome.svelte";
	import ViewsGrid from "./views/ViewsGrid.svelte";

	let { data }: import("./$types").LayoutProps = $props();
</script>

<ProgressiveBlur
	direction="topToBottom"
	tag="nav"
	aria-label="Visitas"
	data-fixed-header
	class="fixed top-0 left-0 z-10 w-full px-4 pt-fixed-header pb-2"
	bgClass="bg-linear-to-b from-background to-transparent"
	contentClass="flex h-10 items-center w-full max-w-120 mx-auto"
	{@attach topChrome}
>
	<h1 class="text-base font-semibold">Visitas</h1>
</ProgressiveBlur>
<ViewsGrid ourProfileId={data.ourProfileId} />
