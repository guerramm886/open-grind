<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import CaretRightIcon from "phosphor-svelte/lib/CaretRightIcon";
	import ImageIcon from "phosphor-svelte/lib/ImageIcon";

	import { receivedArchive } from "$lib/received/archive.svelte";

	// The whole strip under the chat's top bar opens this person's Recibidos,
	// kept away from the cross so neither is tapped by mistake. We mark that we
	// came from the chat so back (and the cross) return here.
	const conversationId = $derived(page.params.conversationId ?? "");
	const count = $derived(receivedArchive.archivedCount(conversationId));
</script>

<a
	href="/received/{conversationId}"
	class="flex h-11 w-full shrink-0 items-center gap-2 bg-sky-500/20 px-4 text-sm font-medium text-sky-700 backdrop-blur-sm active:bg-sky-500/35 dark:text-sky-300"
	onclick={(event) => {
		event.preventDefault();
		void goto(`/received/${conversationId}`, {
			state: { receivedOrigin: "chat" },
		});
	}}
>
	<ImageIcon weight="bold" class="size-5 shrink-0" />
	<span class="truncate">
		Fotos recibidas{#if count > 0}&nbsp;· {count}{/if}
	</span>
	<CaretRightIcon weight="bold" class="ms-auto size-4 shrink-0" />
</a>
