<script lang="ts">
	import { bottomChrome } from "$lib/util/screen-chrome.svelte";
	import OpenConversationButton from "./OpenConversationButton.svelte";

	let {
		ourProfileId,
		profileId,
		active,
	}: { ourProfileId: number; profileId: number; active: boolean } = $props();

	const isOurProfile = $derived(profileId === ourProfileId);
</script>

{#if !isOurProfile}
	<div
		inert={!active}
		class="absolute bottom-[calc(0.5rem+var(--nav-height)+var(--bar-content-gap))] left-1/2 w-90.5 max-w-full -translate-x-1/2 px-2"
		{@attach active && bottomChrome}
	>
		<nav
			aria-label="Chat"
			class="flex flex-row items-center gap-2 rounded-full bg-muted p-2 shadow-xl"
		>
			<OpenConversationButton {profileId} {ourProfileId} />
		</nav>
	</div>
{/if}
