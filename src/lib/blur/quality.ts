import { env } from "$env/dynamic/public";
import z from "zod";

export const backdropBlurQualitySchema = z.enum([
	"max",
	"medium",
	"min",
	"off",
]);

export type BackdropBlurQuality = z.infer<typeof backdropBlurQualitySchema>;

export const BACKDROP_BLUR_QUALITY_ORDER = [
	"off",
	"min",
	"medium",
	"max",
] as const satisfies readonly BackdropBlurQuality[];

export const BACKDROP_BLUR_QUALITY_LABELS: Record<BackdropBlurQuality, string> =
	{ off: "No", min: "Bajo", medium: "Medio", max: "Total" };

export const BACKDROP_BLUR_QUALITY_DESCRIPTIONS: Record<
	BackdropBlurQuality,
	string
> = {
	off: "Sin desenfoque. Las barras y menús usan un fondo sólido.",
	min: "Un desenfoque suave detrás de barras y menús.",
	medium: "Un desenfoque gradual más liviano. Mejor en celulares viejos.",
	max: "El desenfoque gradual completo.",
};

export const UNCALIBRATED_BACKDROP_BLUR_QUALITY =
	"max" satisfies BackdropBlurQuality;

export const BACKDROP_BLUR_ROOT_ATTRIBUTE = "data-backdrop-blur";

export const BACKDROP_BLUR_MIRROR_KEY = "open-grind:backdrop-blur";

export function backdropFilterSupported(): boolean {
	const css = globalThis.CSS as typeof CSS | undefined;
	if (typeof css?.supports !== "function") return false;
	return (
		css.supports("backdrop-filter", "blur(1px)") ||
		css.supports("-webkit-backdrop-filter", "blur(1px)")
	);
}

export function configuredBackdropBlurQuality(): BackdropBlurQuality | null {
	const configured = backdropBlurQualitySchema.safeParse(
		env.PUBLIC_BACKDROP_BLUR,
	);
	return configured.success ? configured.data : null;
}
