import { expect, test } from "@playwright/test";

import {
	ensureGridLocation,
	FIRST_ROUTE_COMPILE_MS,
	historyDepth,
	installTauriShim,
} from "./support/app";

const VIEWS = "/interest/views";
const PROFILE_LINK = 'a[href^="/profile/"]';

test.describe.configure({ timeout: 300_000 });

test("reselecting visits never grows history", async ({ page }) => {
	await installTauriShim(page);
	await page.goto(VIEWS);
	await page
		.locator(PROFILE_LINK)
		.first()
		.waitFor({ timeout: FIRST_ROUTE_COMPILE_MS });
	const atViews = await historyDepth(page);
	await page.getByRole("link", { name: "Visitas", exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`${VIEWS}$`));
	const afterTab = await historyDepth(page);
	expect(afterTab).toBe(atViews);
});

test("the Browse tab returns to the grid instead of pushing a duplicate", async ({
	page,
}) => {
	await installTauriShim(page);
	await page.goto("/");
	await page
		.locator("nav a")
		.first()
		.waitFor({ timeout: FIRST_ROUTE_COMPILE_MS });
	await ensureGridLocation(page);
	await page.locator(PROFILE_LINK).first().waitFor({ timeout: 60_000 });

	await page.locator(PROFILE_LINK).first().click();
	await expect(page).toHaveURL(/\/profile\/\d+$/);
	const atProfile = await historyDepth(page);

	await page.getByRole("link", { name: "Browse" }).click();
	await expect(page).toHaveURL(/\/$/);

	expect(
		await historyDepth(page),
		`history.length went ${atProfile} -> ${await historyDepth(page)} tapping Browse from a profile`,
	).toBe(atProfile);
});
