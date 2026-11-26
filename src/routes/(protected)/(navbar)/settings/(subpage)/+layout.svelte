<script lang="ts">
	import SubpageScreen from "$lib/components/shared/SubpageScreen.svelte";

	const base = "/(protected)/(navbar)/settings/(subpage)";
	const routes = {
		[`${base}/account`]: { title: "Ajustes de la cuenta", back: "/settings" },
		[`${base}/account/privacy`]: {
			title: "Privacidad",
			back: "/settings/account",
		},
		[`${base}/account/blocked`]: {
			title: "Bloqueados",
			back: "/settings/account",
		},
		[`${base}/account/hidden`]: {
			title: "Ocultos",
			back: "/settings/account",
		},
		[`${base}/albums`]: {
			title: "Mis álbumes",
			back: "/settings",
			wide: true,
		},
		[`${base}/albums/new`]: {
			title: "Álbum nuevo",
			back: "/settings/albums",
		},
		[`${base}/albums/[albumId]`]: {
			title: "Editar álbum",
			back: "/settings/albums",
		},
		[`${base}/app`]: { title: "Ajustes de la app", back: "/settings" },
		[`${base}/app/notifications`]: {
			title: "Notificaciones",
			back: "/settings/app",
		},
		[`${base}/app/credits`]: {
			title: "Créditos y licencias",
			back: "/settings/app",
		},
		[`${base}/profile`]: { title: "Editar perfil", back: "/settings" },
	};

	let { children }: import("./$types").LayoutProps = $props();
</script>

<SubpageScreen {routes} parent="/settings">
	{@render children?.()}
</SubpageScreen>
