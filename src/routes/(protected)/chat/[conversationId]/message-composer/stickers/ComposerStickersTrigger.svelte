<script lang="ts">
	import BookmarkSimpleIcon from "phosphor-svelte/lib/BookmarkSimpleIcon";

	import ComposerButton from "../ComposerButton.svelte";
	import { getMessageComposerContext } from "../message-composer-context.svelte";

	let {
		onClick,
		ref = $bindable(null),
	}: { onClick: () => void; ref?: HTMLElement | null } = $props();

	const { disabled } = $derived(getMessageComposerContext()());
</script>

<ComposerButton
	bind:ref
	class="left-0 rounded-s-composer ps-2.75 pe-1.5"
	aria-label="Mensajes guardados"
	onclick={onClick}
	{disabled}
>
	{#snippet icon({ ...props })}
		<BookmarkSimpleIcon {...props} class="size-5.5" />
	{/snippet}
</ComposerButton>
