import { expect, test } from "@playwright/test";

import { installTauriShim } from "./support/app";

test.beforeEach(async ({ page }) => {
	await installTauriShim(page);
});

test("visits replace taps, show visit counts and filter favorites", async ({
	page,
}) => {
	await page.goto("/interest/taps");
	await expect(page).toHaveURL(/\/interest\/views$/);
	await expect(
		page.getByRole("navigation", { name: "Visitas" }),
	).toBeVisible();
	await expect(
		page.getByRole("link", { name: "Taps", exact: true }),
	).toHaveCount(0);
	const first = page.locator('a[href="/profile/100001"]').first();
	const other = page.locator('a[href="/profile/100002"]').first();
	await expect(first).toBeVisible({ timeout: 60_000 });
	await expect(first.locator('[title="Te vio 1 veces"]')).toBeVisible();
	await expect(other.locator('[title="Te vio 2 veces"]')).toBeVisible();
	await expect(page.getByText("Hidden viewer")).toHaveCount(0);
	await expect(page.getByText("Secret admirer")).toHaveCount(0);
	await page.getByRole("button", { name: "Favoritos ❤" }).click();
	await expect(first).toBeVisible();
	await expect(other).toHaveCount(0);
});

test("profiles have no tap action", async ({ page }) => {
	await page.goto("/profile/100001");
	await expect(
		page.getByRole("navigation", { name: "Chat", exact: true }),
	).toBeVisible({ timeout: 60_000 });
	await expect(page.getByRole("button", { name: /send.*tap/i })).toHaveCount(
		0,
	);
});
