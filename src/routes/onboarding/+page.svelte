<script lang="ts">
	import { goto } from "$app/navigation";

	import { showErrorToast } from "$lib/api/error-toast";
	import { setPreferences } from "$lib/app-data/preferences.svelte";
	import { Button } from "$lib/components/ui/button";
	import { Checkbox } from "$lib/components/ui/checkbox";
	import { Label } from "$lib/components/ui/label";
	import {
		desktopEntryAvailable,
		desktopEntryInstalled,
		setDesktopEntryInstalled,
	} from "$lib/platform/desktop-entry.svelte";
	import { updatesSelfManaged } from "$lib/updates/capability.svelte";
	import { saveAutomaticChecks } from "$lib/updates/update-settings.svelte";
	import { bottomChrome } from "$lib/util/screen-chrome.svelte";

	let checkAutomatically = $state(true);
	let addToAppsMenu = $state(true);
	let starting = $state(false);

	const offerAppsMenu = () =>
		desktopEntryAvailable() && !desktopEntryInstalled();

	async function start() {
		starting = true;
		try {
			if (updatesSelfManaged()) {
				await saveAutomaticChecks(checkAutomatically);
			}
			if (addToAppsMenu && offerAppsMenu()) {
				await setDesktopEntryInstalled(true).catch((error: unknown) =>
					showErrorToast({
						label: "Couldn't add Martin's Grindr to your apps",
						error,
					}),
				);
			}
			await setPreferences({ onboardingComplete: true });
			await goto("/");
		} catch (error) {
			starting = false;
			showErrorToast({ label: "Couldn't finish setup", error });
		}
	}
</script>

<svelte:head>
	<title>Welcome</title>
</svelte:head>

<main class="flex min-h-dvh flex-col px-8 pt-[calc(2rem+var(--safe-area-top))]">
	<div
		class="flex flex-1 flex-col items-center justify-center gap-6 text-center"
	>
		<svg
			viewBox="0 0 108 108"
			class="size-28"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
		>
			<path
				d="M33 76 V36 L54 58 L75 36 V76"
				fill="none"
				stroke="var(--primary)"
				stroke-width="8"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
			<path
				d="M80 27 C80 24.5 83.5 23 85.5 25.5 C87.5 23 91 24.5 91 27 C91 30.5 85.5 34 85.5 34 C85.5 34 80 30.5 80 27 Z"
				fill="var(--primary)"
			/>
		</svg>
		<div class="flex flex-col gap-1">
			<h1 class="font-heading text-3xl font-semibold tracking-tight">
				Martin's Grindr
			</h1>
			<p class="text-xl text-muted-foreground">
				Unofficial Grindr client
			</p>
		</div>
		<p class="max-w-sm text-balance text-muted-foreground">
			Cross-platform, free, libre, ad-free, tracker-free, privacy-centered
			and community-driven
		</p>
	</div>

	<div
		class="sticky bottom-0 flex shrink-0 flex-col items-center gap-2 bg-background pt-2 pb-[calc(2rem+var(--safe-area-bottom))]"
		{@attach bottomChrome}
	>
		{#if updatesSelfManaged() || offerAppsMenu()}
			<div class="flex flex-col items-start pb-1">
				{#if updatesSelfManaged()}
					<Label class="flex items-center rounded-xl p-2">
						<Checkbox bind:checked={checkAutomatically} />
						Check updates automatically
					</Label>
				{/if}
				{#if offerAppsMenu()}
					<Label class="flex items-center rounded-xl p-2">
						<Checkbox bind:checked={addToAppsMenu} />
						Add Martin's Grindr to your apps menu
					</Label>
				{/if}
			</div>
		{/if}
		<Button
			size="lg"
			class="w-full max-w-100"
			disabled={starting}
			onclick={start}
		>
			Get started
		</Button>
	</div>
</main>
