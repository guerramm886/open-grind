// One download button for every photo/video viewer (profile photos, albums,
// chat photos and videos), so saving to the gallery works the same everywhere.

import { toast } from "svelte-sonner";
import type PhotoSwipeLightbox from "photoswipe/lightbox";

import { unproxyMediaUrl } from "$lib/util/media";

const DOWNLOAD_ICON =
	'<svg aria-hidden="true" class="pswp__icn" viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 15.5l-5-5 1.4-1.4L11 11.7V3h2v8.7l2.6-2.6L17 10.5l-5 5zM5 19v-2h14v2z"/></svg>';

export function applyPhotoSwipeDownload(
	lightbox: PhotoSwipeLightbox,
	{
		videoSrcAt,
	}: { videoSrcAt?: (index: number) => string | null | undefined } = {},
): void {
	let saving = false;
	lightbox.on("uiRegister", () => {
		lightbox.pswp?.ui?.registerElement({
			name: "download-media",
			title: "Guardar en la galería",
			ariaLabel: "Guardar en la galería",
			order: 9,
			isButton: true,
			html: DOWNLOAD_ICON,
			onClick: (_event, _element, pswp) => {
				if (saving) return;
				const slide = pswp.currSlide;
				if (!slide) return;
				const element = slide.data.element;
				const dataset =
					element instanceof HTMLElement ? element.dataset : null;
				const videoSrc = videoSrcAt?.(slide.index) ?? null;
				// The thumbnail may carry the raw URL; otherwise recover it
				// from the (proxied) source being shown.
				let target: { url: string; isVideo: boolean } | null = null;
				if (dataset?.rawUrl)
					target = {
						url: dataset.rawUrl,
						isVideo: dataset.mediaKind === "video",
					};
				else if (videoSrc) {
					const raw = unproxyMediaUrl(videoSrc);
					target = raw ? { url: raw.url, isVideo: true } : null;
				} else if (typeof slide.data.src === "string")
					target = unproxyMediaUrl(slide.data.src);
				if (!target) {
					toast.error("Esto no se puede guardar");
					return;
				}
				saving = true;
				const { url, isVideo } = target;
				// Loaded on demand: the saver pulls in the whole Recibidos
				// archive, which the viewers don't otherwise need.
				void import("$lib/received/save-to-device")
					.then(async ({ GALLERY_FOLDER, saveUrlToDevice }) => {
						await saveUrlToDevice({
							rawUrl: url,
							baseName: `grindr-${Date.now()}`,
							isVideo,
						});
						toast.success(`Guardado en Galería › ${GALLERY_FOLDER}`);
					})
					.catch((error: unknown) => {
						console.error("[lightbox] save failed", error);
						toast.error("No se pudo guardar");
					})
					.finally(() => {
						saving = false;
					});
			},
		});
	});
}