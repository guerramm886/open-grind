<script lang="ts">
	import { toast } from "svelte-sonner";

	import { showErrorToast } from "$lib/api/error-toast";
	import { shareAlbum } from "$lib/api/messaging/albums";
	import { sendMessage } from "$lib/api/messaging/messages";
	import { greeting } from "$lib/chat/greeting.svelte";
	import { mediaMessageDraft } from "../../../../chat/[conversationId]/message-composer/attachments/media/media-messages";

	let { profileId }: { profileId: number } = $props();

	// Profiles already greeted from here, so a second tap doesn't re-send the
	// text and photos.
	const GREETED_KEY = "profile-greeted-v1";
	function loadGreeted(): number[] {
		try {
			const list: unknown = JSON.parse(
				localStorage.getItem(GREETED_KEY) ?? "[]",
			);
			return Array.isArray(list)
				? list.filter((id): id is number => typeof id === "number")
				: [];
		} catch {
			return [];
		}
	}
	let greeted = $state<number[]>(loadGreeted());
	let sending = $state(false);

	const alreadyGreeted = $derived(greeted.includes(profileId));

	function markGreeted(id: number) {
		greeted = [...greeted.filter((item) => item !== id), id].slice(-500);
		try {
			localStorage.setItem(GREETED_KEY, JSON.stringify(greeted));
		} catch {
			/* storage unavailable */
		}
	}

	async function send() {
		if (sending) return;
		if (!greeting.configured) {
			toast(
				"Todavía no configuraste el saludo. Abrí un chat y mantené apretada la 👋 para armarlo.",
			);
			return;
		}
		if (alreadyGreeted) {
			toast("Ya le mandaste el saludo a este perfil.");
			return;
		}
		const target = profileId;
		sending = true;
		try {
			await sendMessage({
				toUserId: target,
				message: { type: "Text", body: { text: greeting.message.trim() } },
			});
			// Photos as configured: with photos if there are any, none otherwise.
			for (const item of greeting.photos) {
				await sendMessage({
					toUserId: target,
					message: mediaMessageDraft({ item, expiring: false }).outbound,
				});
			}
			if (greeting.albumId !== null) {
				await shareAlbum({
					albumId: greeting.albumId,
					profileIds: [target],
				}).catch((error: unknown) => console.error(error));
			}
			markGreeted(target);
			toast.success("Saludo enviado 👋");
		} catch (error) {
			console.error(error);
			showErrorToast({ label: "No se pudo enviar el saludo", error });
		} finally {
			sending = false;
		}
	}
</script>

<button
	type="button"
	aria-label={alreadyGreeted ? "Saludo ya enviado" : "Enviar saludo"}
	title={alreadyGreeted ? "Saludo ya enviado" : "Enviar saludo"}
	disabled={sending}
	class={[
		"flex size-11 shrink-0 items-center justify-center rounded-full bg-input/20 text-2xl transition active:scale-90 disabled:opacity-50",
		alreadyGreeted && "opacity-50",
	]}
	onclick={() => void send()}
>
	{sending ? "…" : alreadyGreeted ? "✅" : "👋"}
</button>
