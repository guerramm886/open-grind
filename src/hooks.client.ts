import type { ClientInit, HandleClientError } from "@sveltejs/kit";

import { installErrorBanner, showError } from "$lib/util/error-banner";
import { ws } from "$lib/ws.svelte";

export const init: ClientInit = () => {
	installErrorBanner();
	ws.connect();
	// Starts the automatic copy to the home server (phone app only).
	void import("$lib/backup/home-server.svelte").catch((error: unknown) =>
		console.error("[home-server] could not start", error),
	);
};

export const handleError: HandleClientError = ({ error, event }) => {
	console.error("Error during request to", event.url.pathname, ":", error);
	showError(event.url.pathname, error);
};
