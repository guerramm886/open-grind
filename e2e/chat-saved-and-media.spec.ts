import { expect, test } from "@playwright/test";

import {
	DEMO_CONVERSATION,
	installTauriShim,
	MESSAGE_ROW,
} from "./support/app";
import {
	ALBUM_TILE,
	DRAWER,
	MEDIA_TILE,
	openAttachments,
	UNSHARED_ALBUM_TILE,
} from "./support/drawer";
import { CHAT_MEDIA_HOST, serveImages } from "./support/media";

test("shows photos and albums together and allows selecting both", async ({
	page,
}) => {
	await serveImages(page, CHAT_MEDIA_HOST);
	await openAttachments(page);
	await expect(page.locator(ALBUM_TILE).first()).toBeVisible({
		timeout: 30_000,
	});
	await expect(page.locator(MEDIA_TILE).first()).toBeVisible();
	await expect(page.getByRole("tab", { name: "Albums" })).toHaveCount(0);
	await page.locator(UNSHARED_ALBUM_TILE).first().click();
	await page.locator(MEDIA_TILE).first().click();
	await expect(
		page.getByRole("button", { name: /^Send\s*2$/ }),
	).toBeVisible();
});

test("offers saved messages instead of the GIF button", async ({ page }) => {
	await installTauriShim(page);
	await page.goto(DEMO_CONVERSATION);
	await page.getByRole("button", { name: "Mensajes guardados" }).click();
	await expect(page.locator(DRAWER)).toBeVisible();
	await expect(page.getByText("Mensajes guardados").first()).toBeVisible();
});

test("saves a frequent message with a photo and sends it", async ({ page }) => {
	await serveImages(page, CHAT_MEDIA_HOST);
	await installTauriShim(page);
	await page.goto(DEMO_CONVERSATION);
	const photos = page.getByRole("link", { name: "Photo", exact: true });
	await page.locator('[data-slot="message-composer"]').waitFor();
	await page.locator(MESSAGE_ROW).first().waitFor();
	const before = await photos.count();
	await page.getByRole("button", { name: "Mensajes guardados" }).click();
	await page.getByRole("button", { name: "+ Agregar mensaje" }).click();
	await page
		.getByRole("textbox", { name: "Texto del mensaje guardado" })
		.fill("Hola, mensaje frecuente de prueba");
	await page
		.getByRole("button", { name: "Seleccionar foto" })
		.first()
		.click();
	await page.getByRole("button", { name: "Guardar", exact: true }).click();
	await page
		.getByRole("button", { name: /Hola, mensaje frecuente de prueba/ })
		.click();
	await expect(
		page.getByText("Hola, mensaje frecuente de prueba", { exact: true }),
	).toBeVisible();
	await expect(photos).toHaveCount(before + 1);
});
