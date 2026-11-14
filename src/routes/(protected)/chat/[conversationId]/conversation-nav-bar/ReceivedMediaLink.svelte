<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import ImageIcon from "phosphor-svelte/lib/ImageIcon";

	// One place for everything this person sent: their Recibidos gallery. We
	// mark that we came from the chat so back (and the cross) return here.
	const conversationId = $derived(page.params.conversationId ?? "");
</script>

<a
	href="/received/{conversationId}"
	aria-label="Fotos y videos recibidos"
	class="rounded-full p-3"
	onclick={(event) => {
		event.preventDefault();
		void goto(`/received/${conversationId}`, {
			state: { receivedOrigin: "chat" },
		});
	}}
>
	<ImageIcon class="size-6" />
</a>
