// Shows unexpected errors on screen (red box at the top, tap to close), so a
// screen that silently refuses to open says why. Plain DOM on purpose: it must
// work even when the Svelte app itself is the thing failing.

const MAX_SHOWN = 4;
let box: HTMLDivElement | null = null;
const seen = new Set<string>();

function describe(error: unknown): string {
	if (error instanceof Error) {
		const stack = (error.stack ?? "")
			.split("\n")
			.slice(0, 6)
			.join("\n");
		return stack.includes(error.message) ? stack : `${error.message}\n${stack}`;
	}
	try {
		return typeof error === "string" ? error : JSON.stringify(error);
	} catch {
		return String(error);
	}
}

export function showError(where: string, error: unknown): void {
	if (typeof document === "undefined") return;
	const text = `${where}: ${describe(error)}`;
	if (seen.has(text) || seen.size >= 50) return;
	seen.add(text);
	if (!box) {
		box = document.createElement("div");
		box.setAttribute("role", "alert");
		box.style.cssText =
			"position:fixed;top:env(safe-area-inset-top,0);left:0;right:0;z-index:2147483647;" +
			"max-height:45vh;overflow:auto;background:#7f1d1d;color:#fff;font:12px/1.35 monospace;" +
			"padding:8px 10px;white-space:pre-wrap;word-break:break-word;";
		const hint = document.createElement("div");
		hint.textContent = "Error (tocá para cerrar, mandale captura a Claude):";
		hint.style.cssText = "font-weight:bold;margin-bottom:4px";
		box.append(hint);
		box.addEventListener("click", () => {
			box?.remove();
			box = null;
		});
		document.body.append(box);
	}
	const line = document.createElement("div");
	line.textContent = text;
	line.style.cssText = "border-top:1px solid #fca5a5;padding-top:4px;margin-top:4px";
	box.append(line);
	while (box.childElementCount > MAX_SHOWN + 1) box.children[1]?.remove();
}

export function installErrorBanner(): void {
	if (typeof window === "undefined") return;
	window.addEventListener("error", (event) => {
		showError("error", event.error ?? event.message);
	});
	window.addEventListener("unhandledrejection", (event) => {
		showError("promesa", event.reason);
	});
}
