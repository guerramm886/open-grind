<script lang="ts">
	import NotePencilIcon from "phosphor-svelte/lib/NotePencilIcon";
	import { untrack } from "svelte";

	import { profileNotes } from "$lib/profile/profile-notes.svelte";
	import ProfileSection from "./ProfileSection.svelte";

	let { profileId }: { profileId: number } = $props();

	let draft = $state("");
	// Re-load the note only when the profile changes (not on every keystroke).
	$effect(() => {
		const id = profileId;
		untrack(() => {
			draft = profileNotes.get(id);
		});
	});

	function save() {
		profileNotes.set(profileId, draft);
	}
</script>

<ProfileSection title="Nota privada">
	<div class="flex items-start gap-2">
		<NotePencilIcon class="mt-1.5 size-5 shrink-0 text-muted-foreground" />
		<textarea
			bind:value={draft}
			oninput={save}
			onblur={save}
			rows="2"
			placeholder="Solo la ves vos…"
			class="w-full rounded-xl bg-secondary p-2 text-base text-foreground"
		></textarea>
	</div>
</ProfileSection>
