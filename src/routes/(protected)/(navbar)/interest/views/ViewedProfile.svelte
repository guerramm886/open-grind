<script lang="ts">
	import EyeIcon from "phosphor-svelte/lib/EyeIcon";

	import ProfileMiniCard from "$lib/components/profile/ProfileMiniCard.svelte";
	import type { ViewerProfile } from "$lib/model/interest/views";

	let { view }: { view: ViewerProfile } = $props();

	const { totalCount, maxDisplayCount } = $derived(view.viewedCount);
	const viewedCountLabel = $derived(
		totalCount > maxDisplayCount ? `${maxDisplayCount}+` : `${totalCount}`,
	);
</script>

<ProfileMiniCard
	mediaHash={view.profileImageMediaHash}
	displayName={view.displayName}
	distance={view.distance}
	onlineUntil={view.onlineUntil}
	isFavorite={view.isFavorite}
	href="/profile/{view.profileId}"
>
	{#snippet overlay()}
		<div
			class="absolute right-1.5 bottom-1.5 z-1 flex items-center gap-0.5 rounded-full bg-black/75 px-1.5 py-0.5 text-2xs font-semibold text-white"
			title="Te vio {totalCount} veces"
		>
			<EyeIcon weight="bold" class="size-3" />
			{viewedCountLabel}<span class="sr-only">veces que te vio</span>
		</div>
	{/snippet}
</ProfileMiniCard>
