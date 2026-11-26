<script lang="ts">
	import ChatsCircleIcon from "phosphor-svelte/lib/ChatsCircleIcon";
	import CodeIcon from "phosphor-svelte/lib/CodeIcon";
	import GlobeIcon from "phosphor-svelte/lib/GlobeIcon";
	import MegaphoneIcon from "phosphor-svelte/lib/MegaphoneIcon";

	import Link from "./LinkItem.svelte";
</script>

<Link destination="https://opengrind.org/" label="Sitio web">
	{#snippet icon()}
		<GlobeIcon weight="bold" class="size-5" />
	{/snippet}
</Link>

<Link
	destination="https://git.opengrind.org/open-grind/open-grind/"
	label="Código fuente"
>
	{#snippet icon()}
		<CodeIcon weight="bold" class="size-5" />
	{/snippet}
</Link>
<Link
	destination="https://t.me/opengrind"
	label="Novedades"
	warning={{
		title: "El canal de Telegram es semioficial",
		description:
			"You're about to visit a Telegram channel that operates as a convenient mirror of the official announcements room hosted on Matrix. ",
		primary: {
			label: "Abrir el canal de Telegram",
			destination: "https://t.me/opengrind",
		},
		secondary: {
			label: "Entrar a la sala oficial de Matrix",
			destination: "https://matrix.to/#/#announcements:opengrind.org",
		},
	}}
>
	{#snippet icon()}
		<MegaphoneIcon weight="bold" class="size-5" />
	{/snippet}
</Link>
<Link
	destination="https://matrix.to/#/#general:opengrind.org"
	label="Comunidad"
>
	{#snippet icon()}
		<ChatsCircleIcon weight="bold" class="size-5" />
	{/snippet}
</Link>
