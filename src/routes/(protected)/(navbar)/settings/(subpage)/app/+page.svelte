<script lang="ts">
	import ArrowSquareOutIcon from "phosphor-svelte/lib/ArrowSquareOutIcon";
	import CaretRightIcon from "phosphor-svelte/lib/CaretRightIcon";
	import { toast } from "svelte-sonner";
	import type { IconComponentProps } from "phosphor-svelte";

	import ToastUnimplemented from "$lib/components/feedback/ToastUnimplemented.svelte";
	import * as Item from "$lib/components/ui/item";
	import Link from "$lib/components/ui/link/Link.svelte";
	import { hapticsAvailable } from "$lib/haptics";
	import { desktopEntryAvailable } from "$lib/platform/desktop-entry.svelte";
	import { addonInstallerAvailable } from "$lib/updates/addon.svelte";
	import {
		updatesSelfManaged,
		updatesUnsupportedReason,
	} from "$lib/updates/capability.svelte";
	import AppsMenuEntrySetting from "./AppsMenuEntrySetting.svelte";
	import AutomaticUpdatesSetting from "./AutomaticUpdatesSetting.svelte";
	import BackdropBlurSetting from "./BackdropBlurSetting.svelte";
	import BackupSetting from "./BackupSetting.svelte";
	import HomeServerSetting from "./HomeServerSetting.svelte";
	import SyncDevicesSetting from "./SyncDevicesSetting.svelte";
	import { isWebServer } from "$lib/platform/os";
	import GeminiKeySetting from "./GeminiKeySetting.svelte";
	import PreferenceSwitchSetting from "./PreferenceSwitchSetting.svelte";
	import UnitsSetting from "./UnitsSetting.svelte";
</script>

{#snippet rowContent({
	title,
	trailingIcon: TrailingIcon = CaretRightIcon,
}: {
	title: string;
	trailingIcon?: import("svelte").Component<IconComponentProps>;
})}
	<Item.Content class="max-cramped:min-w-0">
		<Item.Title class="inline-block max-w-full min-w-0 truncate">
			{title}
		</Item.Title>
	</Item.Content>
	<Item.Actions class="min-w-0">
		<TrailingIcon class="size-4 shrink-0" />
	</Item.Actions>
{/snippet}
{#snippet item({
	title,
	unimplemented,
}: {
	title: string;
	unimplemented: { feature: string; issue: number };
})}
	<Item.Root variant="outline">
		{#snippet child({ props })}
			<a
				href="#/"
				{...props}
				onclick={(event) => {
					event.preventDefault();
					toast(ToastUnimplemented, {
						componentProps: unimplemented,
					});
				}}
			>
				{@render rowContent({ title })}
			</a>
		{/snippet}
	</Item.Root>
{/snippet}
<h2>Búsqueda</h2>
<GeminiKeySetting />
<h2>Backup</h2>
{#if isWebServer()}
	<SyncDevicesSetting />
{/if}
<HomeServerSetting />
<BackupSetting />
<h2>Pantalla</h2>
<UnitsSetting />
<BackdropBlurSetting />
{#if hapticsAvailable()}
	<PreferenceSwitchSetting
		preference="hapticFeedback"
		title="Vibración"
		description="Vibra un poco al tocar algunas cosas."
	/>
{/if}
{#if desktopEntryAvailable()}
	<AppsMenuEntrySetting />
{/if}
<Item.Root variant="outline">
	{#snippet child({ props })}
		<a href="/settings/app/notifications" {...props}>
			{@render rowContent({ title: "Notificaciones" })}
		</a>
	{/snippet}
</Item.Root>
<h2>Privacidad</h2>
<PreferenceSwitchSetting
	preference="stayOnline"
	title="Seguir online mientras la app está abierta"
	description="Renueva tu estado online solo, mientras la app está abierta."
/>
<PreferenceSwitchSetting
	preference="revealMessageRead"
	title="Mostrar que leí los mensajes"
	description="Los demás ven cuándo leíste sus mensajes. Vos seguís viendo cuándo leen los tuyos."
/>
<PreferenceSwitchSetting
	preference="revealProfileViews"
	title="Mostrar que vi su perfil"
	description="Los demás ven que miraste su perfil. Vos seguís viendo quién mira el tuyo."
/>
<PreferenceSwitchSetting
	preference="giphyConsent"
	title="Buscar GIFs con GIPHY"
	description="Buscar y mandar GIFs de GIPHY en los chats. GIPHY ve tu dirección IP, lo que buscás y que el pedido viene de una app de Grindr."
/>
<h2>Seguridad</h2>
{@render item({
	title: "Ícono discreto",
	unimplemented: { feature: "Ícono discreto", issue: 97 },
})}
{@render item({ title: "PIN", unimplemented: { feature: "PIN", issue: 50 } })}
{#if updatesSelfManaged() || updatesUnsupportedReason() !== null || addonInstallerAvailable()}
	<h2>Actualizaciones</h2>
	<AutomaticUpdatesSetting />
{/if}
<h2>Acerca de</h2>
<Item.Root variant="outline">
	{#snippet child({ props })}
		<Link href="https://opengrind.org/privacy" {...props}>
			{@render rowContent({
				title: "Política de privacidad",
				trailingIcon: ArrowSquareOutIcon,
			})}
		</Link>
	{/snippet}
</Item.Root>
<Item.Root variant="outline">
	{#snippet child({ props })}
		<a href="/settings/app/credits" {...props}>
			{@render rowContent({ title: "Créditos y licencias" })}
		</a>
	{/snippet}
</Item.Root>

<style lang="postcss">
	@reference "$layout";

	h2 {
		@apply mt-2 truncate ps-4 text-xl font-semibold tracking-tight;
	}
</style>
