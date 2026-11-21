// Loaded by the server before the app, in place of Tauri: the page calls
// invoke()/listen()/convertFileSrc() exactly as in the Android app, and this
// sends them to the server. It also keeps the page's settings (localStorage)
// on the server, so they never live only in one browser.
(() => {
	"use strict";
	if (window.__OG_WEB__) return;
	window.__OG_WEB__ = true;

	const toLogin = () => {
		if (location.pathname !== "/acceso") location.href = "/acceso";
	};

	// ---------------------------------------------------------------- storage
	// Settings that belong to this browser/screen only, not to the account.
	const LOCAL_ONLY = new Set([
		"open-grind:backdrop-blur",
		"gemini-bubble-position-v1",
	]);
	const synced = (key) => typeof key === "string" && !LOCAL_ONLY.has(key);

	const proto = Storage.prototype;
	const rawSet = proto.setItem;
	const rawRemove = proto.removeItem;
	const rawClear = proto.clear;
	const local = window.localStorage;

	// Before the app reads anything: the server's copy is the truth.
	try {
		const xhr = new XMLHttpRequest();
		xhr.open("GET", "/api/storage", false);
		xhr.send();
		if (xhr.status === 401) toLogin();
		if (xhr.status === 200) {
			const server = JSON.parse(xhr.responseText);
			const serverKeys = Object.keys(server);
			if (serverKeys.length === 0 && local.length > 0) {
				// First visit after using this browser on its own: keep what it
				// has and send it up.
				const set = {};
				for (let i = 0; i < local.length; i++) {
					const key = local.key(i);
					if (synced(key)) set[key] = local.getItem(key);
				}
				fetch("/api/storage", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ set }),
				}).catch(() => {});
			} else {
				const keep = {};
				for (const key of LOCAL_ONLY) {
					const value = local.getItem(key);
					if (value !== null) keep[key] = value;
				}
				rawClear.call(local);
				for (const key of serverKeys) rawSet.call(local, key, server[key]);
				for (const key of Object.keys(keep)) rawSet.call(local, key, keep[key]);
			}
		}
	} catch (error) {
		console.error("[og] could not load settings from the server", error);
	}

	let pendingSet = {};
	let pendingRemove = new Set();
	let clearAll = false;
	let timer = null;
	let failures = 0;

	function flush(keepalive = false) {
		timer = null;
		if (!clearAll && pendingRemove.size === 0 && Object.keys(pendingSet).length === 0)
			return;
		const body = JSON.stringify({
			set: pendingSet,
			remove: [...pendingRemove],
			clear: clearAll,
		});
		const sent = { set: pendingSet, remove: pendingRemove, clear: clearAll };
		pendingSet = {};
		pendingRemove = new Set();
		clearAll = false;
		fetch("/api/storage", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body,
			keepalive: keepalive && body.length < 60000,
		})
			.then((response) => {
				if (response.status === 401) toLogin();
				if (!response.ok) throw new Error(`status ${response.status}`);
				failures = 0;
			})
			.catch((error) => {
				// Put it back (newer changes win) and try again shortly.
				console.warn("[og] settings not saved yet", error);
				clearAll ||= sent.clear;
				for (const key of sent.remove)
					if (!(key in pendingSet)) pendingRemove.add(key);
				for (const [key, value] of Object.entries(sent.set))
					if (!(key in pendingSet) && !pendingRemove.has(key)) pendingSet[key] = value;
				failures += 1;
				schedule(Math.min(30000, 1000 * 2 ** failures));
			});
	}

	function schedule(delay = 400) {
		if (timer === null) timer = setTimeout(flush, delay);
	}

	proto.setItem = function (key, value) {
		rawSet.call(this, key, value);
		if (this === local && synced(key)) {
			pendingRemove.delete(key);
			pendingSet[key] = String(value);
			schedule();
		}
	};
	proto.removeItem = function (key) {
		rawRemove.call(this, key);
		if (this === local && synced(key)) {
			delete pendingSet[key];
			pendingRemove.add(key);
			schedule();
		}
	};
	proto.clear = function () {
		rawClear.call(this);
		if (this === local) {
			pendingSet = {};
			pendingRemove = new Set();
			clearAll = true;
			schedule();
		}
	};
	addEventListener("pagehide", () => flush(true));
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") flush(true);
	});

	// -------------------------------------------------------------- callbacks
	const callbacks = new Map();
	let nextId = 1;
	function transformCallback(callback, once = false) {
		const id = nextId++;
		callbacks.set(id, (payload) => {
			if (once) callbacks.delete(id);
			return callback?.(payload);
		});
		return id;
	}
	function unregisterCallback(id) {
		callbacks.delete(id);
	}

	// ----------------------------------------------------------------- events
	/** event name -> Map(eventId -> callback id) */
	const listeners = new Map();
	let source = null;

	function dispatch(event, payload) {
		const handlers = listeners.get(event);
		if (!handlers) return;
		for (const [eventId, callbackId] of [...handlers]) {
			try {
				callbacks.get(callbackId)?.({ event, id: eventId, payload });
			} catch (error) {
				console.error(`[og] listener for ${event} failed`, error);
			}
		}
	}

	function openEvents() {
		if (source) return;
		source = new EventSource("/api/events");
		source.onmessage = (message) => {
			try {
				const { event, payload } = JSON.parse(message.data);
				dispatch(event, payload);
			} catch (error) {
				console.error("[og] bad event", error);
			}
		};
		source.onerror = () => {
			// EventSource reconnects by itself; the page hears it as a drop.
			dispatch("ws:disconnected", null);
		};
	}

	function listen({ event, handler }) {
		const eventId = nextId++;
		if (!listeners.has(event)) listeners.set(event, new Map());
		listeners.get(event).set(eventId, handler);
		openEvents();
		return eventId;
	}

	function unlisten(event, eventId) {
		listeners.get(event)?.delete(eventId);
	}

	// ---------------------------------------------------------------- plugins
	const unsupported = (cmd) =>
		Promise.reject({ kind: "Unsupported", message: cmd });

	function geolocation(command) {
		if (command === "check_permissions" || command === "request_permissions") {
			const ask =
				command === "request_permissions"
					? new Promise((resolve) =>
							navigator.geolocation.getCurrentPosition(
								() => resolve("granted"),
								() => resolve("denied"),
							),
						)
					: navigator.permissions
							?.query({ name: "geolocation" })
							.then((status) => status.state)
							.catch(() => "prompt") ?? Promise.resolve("prompt");
			return ask.then((state) => ({ location: state, coarseLocation: state }));
		}
		if (command === "get_current_position") {
			return new Promise((resolve, reject) =>
				navigator.geolocation.getCurrentPosition(
					(position) =>
						resolve({
							timestamp: position.timestamp,
							coords: {
								latitude: position.coords.latitude,
								longitude: position.coords.longitude,
								accuracy: position.coords.accuracy,
								altitude: position.coords.altitude,
								altitudeAccuracy: position.coords.altitudeAccuracy,
								speed: position.coords.speed,
								heading: position.coords.heading,
							},
						}),
					(error) => reject(error.message),
					{ enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 },
				),
			);
		}
		return unsupported(`plugin:geolocation|${command}`);
	}

	function plugin(cmd, args) {
		const [name, command] = cmd.slice("plugin:".length).split("|");
		switch (name) {
			case "event":
				if (command === "listen") return Promise.resolve(listen(args));
				if (command === "unlisten") {
					unlisten(args.event, args.eventId);
					return Promise.resolve(null);
				}
				if (command === "emit" || command === "emit_to") {
					dispatch(args.event, args.payload);
					return Promise.resolve(null);
				}
				break;
			case "os":
				if (command === "locale") return Promise.resolve(navigator.language);
				if (command === "hostname") return Promise.resolve("web");
				break;
			case "clipboard-manager":
				if (command === "write_text")
					return navigator.clipboard.writeText(args?.text ?? "").then(() => null);
				if (command === "read_text") return navigator.clipboard.readText();
				break;
			case "opener":
				if (command === "open_url" || command === "open_path") {
					window.open(args?.url ?? args?.path, "_blank", "noopener");
					return Promise.resolve(null);
				}
				break;
			case "dialog":
				if (command === "message") {
					alert(args?.message ?? "");
					return Promise.resolve("Ok");
				}
				if (command === "ask" || command === "confirm")
					return Promise.resolve(confirm(args?.message ?? ""));
				break;
			case "geolocation":
				return geolocation(command);
		}
		return unsupported(cmd);
	}

	// ----------------------------------------------------------------- invoke
	async function invoke(cmd, args = {}) {
		if (cmd.startsWith("plugin:")) return plugin(cmd, args);
		let response;
		try {
			response = await fetch(`/api/invoke/${encodeURIComponent(cmd)}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(args ?? null),
			});
		} catch (error) {
			throw { kind: "Connect", message: String(error) };
		}
		if (response.status === 401) {
			toLogin();
			throw { kind: "NotSignedIn" };
		}
		const text = await response.text();
		let value = null;
		try {
			value = text === "" ? null : JSON.parse(text);
		} catch {
			value = text;
		}
		if (!response.ok) throw value ?? { kind: "Http", message: `status ${response.status}` };
		return value;
	}

	function convertFileSrc(path, protocol = "asset") {
		if (protocol === "ogmedia") return `${location.origin}/og-media/${path}`;
		return `${location.origin}/og-file/${encodeURIComponent(path)}`;
	}

	const android = /Android/i.test(navigator.userAgent);
	window.__TAURI_OS_PLUGIN_INTERNALS__ = {
		platform: android ? "android" : "linux",
		version: "",
		family: "unix",
		os_type: android ? "android" : "linux",
		arch: "x86_64",
		exe_extension: "",
		eol: "\n",
	};
	window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: unlisten };
	window.__TAURI_INTERNALS__ = {
		invoke,
		transformCallback,
		unregisterCallback,
		convertFileSrc,
		callbacks,
		metadata: {
			currentWindow: { label: "main" },
			currentWebview: { windowLabel: "main", label: "main" },
		},
		plugins: {},
	};
	window.isTauri = true;
})();
