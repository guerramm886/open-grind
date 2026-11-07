// Tauri doesn't have a Node.js server to do proper SSR
// so we use adapter-static with a fallback to index.html to put the site in SPA mode
// See: https://svelte.dev/docs/kit/single-page-apps
// See: https://v2.tauri.app/start/frontend/sveltekit/ for more info
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const projectVersion = JSON.parse(
	fs.readFileSync(
		path.join(
			path.dirname(fileURLToPath(import.meta.url)),
			"./package.json",
		),
		"utf-8",
	),
).version;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The real API version is scraped from the grindr crate via cargo. That needs a
// Rust toolchain, which isn't present when only type-checking the frontend; set
// OPEN_GRIND_SKIP_CARGO=1 to fall back to a placeholder (dev/type-check only —
// CI has cargo and always uses the real values).
let grindrApiVersion = "0";
let grindrApiBuildNumber = "0";
try {
	const cargoMetadata = JSON.parse(
		execSync("cargo metadata --format-version 1", {
			cwd: path.join(__dirname, "src-tauri"),
			maxBuffer: 16 * 1024 * 1024,
		}),
	);
	const grindrManifest = cargoMetadata.packages.find(
		(p) => p.name === "grindr",
	)?.manifest_path;
	if (!grindrManifest)
		throw new Error("grindr crate not found in cargo metadata");
	const headersRs = fs.readFileSync(
		path.join(path.dirname(grindrManifest), "src", "headers.rs"),
		"utf-8",
	);
	const scrapeHeaderConst = (name) => {
		const match = headersRs.match(
			new RegExp(`const ${name}: &str = "([^"]+)";`),
		);
		if (!match)
			throw new Error(`${name} not found in the grindr crate headers`);
		return match[1];
	};
	grindrApiVersion = scrapeHeaderConst("APP_VERSION");
	grindrApiBuildNumber = scrapeHeaderConst("BUILD_NUMBER");
} catch (error) {
	if (!process.env.OPEN_GRIND_SKIP_CARGO) throw error;
	console.warn(
		"[svelte.config] cargo unavailable; using a placeholder API version (type-check/dev only)",
	);
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	compilerOptions: { experimental: { async: true } },
	kit: {
		adapter: adapter({ fallback: "index.html" }),
		alias: { $layout: "src/layout.css" },
		version: {
			name: `OpenGrind/${projectVersion}\ngrindr3/${grindrApiVersion};${grindrApiBuildNumber}`,
		},
	},
};

export default config;
