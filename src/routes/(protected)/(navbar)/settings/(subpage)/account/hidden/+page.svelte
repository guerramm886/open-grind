<script lang="ts" module>
	const scroll = { scrollY: 0 };
</script>

<script lang="ts">
	import EyeSlashIcon from "phosphor-svelte/lib/EyeSlashIcon";

	import {
		getHiddenUserIdsNewestFirst,
		hideUser,
		unhideUser,
	} from "$lib/api/browse/hides";
	import ProfileList from "$lib/components/profile-list/ProfileList.svelte";
</script>

<svelte:head>
	<title>Hidden users</title>
</svelte:head>

{#snippet icon(on: boolean)}
	<EyeSlashIcon weight={on ? "fill" : "regular"} class="size-6" />
{/snippet}

<ProfileList
	eager
	loadIds={getHiddenUserIdsNewestFirst}
	setOn={({ profileId, on }) =>
		on ? hideUser({ profileId }) : unhideUser({ profileId })}
	{icon}
	{scroll}
	label="Oculto"
	errorLabel={{ turningOn: "No se pudo ocultar", turningOff: "No se pudo mostrar" }}
	empty={{
		title: "No ocultaste a nadie",
		description: "Las personas que ocultes aparecen acá.",
	}}
/>
