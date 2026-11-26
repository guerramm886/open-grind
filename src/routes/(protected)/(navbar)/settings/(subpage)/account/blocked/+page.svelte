<script lang="ts" module>
	const scroll = { scrollY: 0 };
</script>

<script lang="ts">
	import ProhibitIcon from "phosphor-svelte/lib/ProhibitIcon";

	import {
		blockUser,
		getBlockedUsers,
		unblockUser,
	} from "$lib/api/browse/blocks";
	import ProfileList from "$lib/components/profile-list/ProfileList.svelte";
</script>

<svelte:head>
	<title>Bloqueados</title>
</svelte:head>

{#snippet icon(on: boolean)}
	<ProhibitIcon weight={on ? "fill" : "regular"} class="size-6" />
{/snippet}

<ProfileList
	loadIds={async () =>
		(await getBlockedUsers()).map(({ profileId }) => profileId)}
	setOn={({ profileId, on }) =>
		on ? blockUser({ profileId }) : unblockUser({ profileId })}
	{icon}
	{scroll}
	label="Bloqueado"
	errorLabel={{
		turningOn: "No se pudo bloquear",
		turningOff: "No se pudo desbloquear",
	}}
	empty={{
		title: "No bloqueaste a nadie",
		description: "Las personas que bloquees aparecen acá.",
	}}
/>
