// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/svelte";
import { flushSync } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Os from "$lib/platform/os";
import {
	appLifecycle,
	categories,
	checked,
	currentPlatform,
	disabled,
	inMode,
	opened,
	push,
	resetNotificationsPage,
	stored,
} from "./notifications-page-test-helpers.svelte";

vi.mock(
	"$lib/push/index",
	async () => (await import("./notifications-page-test-helpers.svelte")).push,
);
vi.mock(
	"$lib/api/settings/account",
	async () =>
		(await import("./notifications-page-test-helpers.svelte")).account,
);
vi.mock(
	"$lib/app-data/preferences.svelte",
	async () =>
		(await import("./notifications-page-test-helpers.svelte")).preferences,
);
vi.mock(
	"$lib/updates/addon.svelte",
	async () => (await import("./notifications-page-test-helpers.svelte")).addon,
);
vi.mock("$lib/api/error-toast", async () => ({
	showErrorToast: (await import("./notifications-page-test-helpers.svelte"))
		.showErrorToast,
}));
vi.mock("$lib/platform/link-opener", async () => ({
	openExternalLink: (await import("./notifications-page-test-helpers.svelte"))
		.openExternalLink,
}));
vi.mock("$lib/platform/os", async (importOriginal) => {
	const { currentPlatform } =
		await import("./notifications-page-test-helpers.svelte");
	return {
		...(await importOriginal<typeof Os>()),
		currentPlatform,
		isAndroidPlatform: () => currentPlatform() === "android",
	};
});
vi.mock("$lib/api/app-lifecycle.svelte", async () => ({
	appLifecycle: (await import("./notifications-page-test-helpers.svelte"))
		.appLifecycle,
}));

const NotificationsPage = (await import("./+page.svelte")).default;

const { reconcileNotifications } =
	await import("$lib/push/notifications.svelte");

async function deliveredFast(): Promise<void> {
	inMode("fast");
	await reconcileNotifications();
	vi.clearAllMocks();
}

beforeEach(resetNotificationsPage);

afterEach(cleanup);

describe("the notification categories", () => {
	it("offers messages and hides taps in Fast mode", async () => {
		await deliveredFast();
		const { messages } = await opened(NotificationsPage);

		expect(messages.closest("label")?.textContent.trim()).toBe("New messages");
		expect(checked(messages)).toBe("true");
		expect(screen.queryByRole("switch", { name: "Received taps" })).toBeNull();
	});

	it.each(["macos", "windows", "linux"] as const)(
		"hides received taps on %s",
		async (platform) => {
			currentPlatform.mockReturnValue(platform);
			render(NotificationsPage);
			await screen.findByRole("switch", { name: "New messages" });
			expect(
				screen.queryByRole("switch", { name: "Received taps" }),
			).toBeNull();
		},
	);

	it("opens Android's settings when New messages is turned off and stays on", async () => {
		const { messages } = await opened(NotificationsPage);
		expect(disabled(messages)).toBe(false);

		await fireEvent.click(messages);

		await waitFor(() =>
			expect(push.openPushCategorySettings).toHaveBeenCalledWith("messages"),
		);
		expect(push.setPushCategory).not.toHaveBeenCalled();
		expect(checked(messages)).toBe("true");
	});

	it("opens Android's settings when a blocked New messages is turned on", async () => {
		push.pushCategories.mockResolvedValue(categories({ systemBlocked: true }));
		const { messages } = await opened(NotificationsPage);
		expect(checked(messages)).toBe("false");
		expect(disabled(messages)).toBe(false);

		await fireEvent.click(messages);

		await waitFor(() =>
			expect(push.openPushCategorySettings).toHaveBeenCalledWith("messages"),
		);
		expect(push.setPushCategory).not.toHaveBeenCalled();
		expect(checked(messages)).toBe("false");
	});

	it("disables every category while notifications are off", async () => {
		await deliveredFast();
		stored.notificationsEnabled = false;
		push.pushCategories.mockResolvedValue(categories({ systemBlocked: true }));
		const { messages } = await opened(NotificationsPage);
		expect(disabled(messages)).toBe(true);
	});

	it("reloads the categories only when the app resumes", async () => {
		await deliveredFast();
		const { messages } = await opened(NotificationsPage);
		expect(push.pushCategories).toHaveBeenCalledOnce();

		push.pushCategories.mockResolvedValue(categories({ systemBlocked: true }));
		appLifecycle.active = false;
		flushSync();
		expect(push.pushCategories).toHaveBeenCalledOnce();
		appLifecycle.active = true;
		flushSync();

		await waitFor(() => expect(checked(messages)).toBe("false"));
		expect(push.pushCategories).toHaveBeenCalledTimes(2);
	});
});
