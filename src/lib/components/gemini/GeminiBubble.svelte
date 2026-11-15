<script lang="ts">
	import { tick } from "svelte";

	import { geminiChat } from "$lib/search/gemini-chat.svelte";
	import { gemini } from "$lib/search/gemini-search.svelte";
	import { SCREEN_CAPTURE_IGNORE } from "$lib/search/screen-capture";
	import { visionQueue } from "$lib/search/vision-queue.svelte";

	const POSITION_KEY = "gemini-bubble-position-v1";
	const SIZE = 48;
	const MARGIN = 8;

	type Position = { x: number; y: number };

	function clamp(position: Position): Position {
		return {
			x: Math.min(
				Math.max(position.x, MARGIN),
				window.innerWidth - SIZE - MARGIN,
			),
			y: Math.min(
				Math.max(position.y, MARGIN + 40),
				window.innerHeight - SIZE - MARGIN,
			),
		};
	}

	function loadPosition(): Position {
		try {
			const saved = JSON.parse(
				localStorage.getItem(POSITION_KEY) ?? "null",
			) as Position | null;
			if (
				saved &&
				typeof saved.x === "number" &&
				typeof saved.y === "number"
			)
				return clamp(saved);
		} catch {
			/* fall through to the default spot */
		}
		// Right edge, a bit above the middle: clear of the nav bar and composer.
		return clamp({
			x: window.innerWidth,
			y: Math.round(window.innerHeight * 0.4),
		});
	}

	let position = $state<Position>(loadPosition());
	let open = $state(false);
	let draft = $state("");
	let includeScreen = $state(true);
	let list = $state<HTMLElement | null>(null);

	// Drag to move; a press that doesn't move opens the chat.
	let drag: { dx: number; dy: number; moved: boolean } | null = null;

	function onPointerDown(event: PointerEvent) {
		drag = {
			dx: event.clientX - position.x,
			dy: event.clientY - position.y,
			moved: false,
		};
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function onPointerMove(event: PointerEvent) {
		if (!drag) return;
		const next = { x: event.clientX - drag.dx, y: event.clientY - drag.dy };
		if (
			!drag.moved &&
			Math.hypot(next.x - position.x, next.y - position.y) < 6
		)
			return;
		drag.moved = true;
		position = clamp(next);
	}

	function onPointerUp() {
		const moved = drag?.moved ?? false;
		drag = null;
		if (moved) {
			try {
				localStorage.setItem(POSITION_KEY, JSON.stringify(position));
			} catch {
				/* storage unavailable */
			}
			return;
		}
		open = !open;
	}

	async function send() {
		const text = draft.trim();
		if (text === "" || geminiChat.busy) return;
		draft = "";
		await geminiChat.ask(text, { includeScreen });
	}

	// Keep the newest message in view.
	$effect(() => {
		void [geminiChat.turns.length, geminiChat.busy, open];
		void tick().then(() => {
			if (list) list.scrollTop = list.scrollHeight;
		});
	});

	$effect(() => {
		const onResize = () => (position = clamp(position));
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	});

	const ignore = { [SCREEN_CAPTURE_IGNORE]: "" };
</script>

<div {...ignore} class="contents">
	<button
		type="button"
		aria-label={open ? "Cerrar Gemini" : "Abrir Gemini"}
		aria-expanded={open}
		style="left: {position.x}px; top: {position.y}px; z-index: 100002;"
		class="fixed flex size-12 touch-none items-center justify-center rounded-full bg-primary text-xl text-primary-foreground opacity-85 shadow-xl select-none active:scale-95"
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={() => (drag = null)}
	>
		✨
		{#if geminiChat.busy || visionQueue.pendingCount > 0}
			<span
				class="absolute -top-0.5 -right-0.5 size-3.5 animate-spin rounded-full border-2 border-background/60 border-t-accent bg-background"
			></span>
		{/if}
	</button>

	{#if open}
		<div
			role="dialog"
			aria-label="Chat con Gemini"
			style="z-index: 100001;"
			class="fixed inset-x-2 bottom-2 mx-auto flex max-h-[62vh] max-w-120 flex-col rounded-2xl bg-popover shadow-2xl ring-1 ring-border"
		>
			<div class="flex items-center gap-2 border-b border-border px-3 py-2">
				<p class="flex-1 text-sm font-semibold">✨ Gemini</p>
				{#if geminiChat.turns.length > 0}
					<button
						type="button"
						class="rounded-full bg-secondary px-2 py-1 text-2xs font-semibold"
						onclick={() => geminiChat.clear()}
					>
						Nueva charla
					</button>
				{/if}
				<button
					type="button"
					aria-label="Cerrar"
					class="flex size-7 items-center justify-center rounded-full hover:bg-input/30"
					onclick={() => (open = false)}
				>
					✕
				</button>
			</div>

			<div
				bind:this={list}
				class="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2"
			>
				{#if !gemini.configured}
					<p class="text-xs text-muted-foreground">
						Para usar Gemini cargá tu clave en
						<a
							href="/settings/app"
							class="text-accent underline"
							onclick={() => (open = false)}>Configuración → App</a
						>.
					</p>
				{:else if geminiChat.turns.length === 0}
					<p class="text-xs text-muted-foreground">
						Preguntame sobre lo que estás viendo ("describime a esta
						persona", "¿qué dice este perfil?") o pedime que busque en la
						cuadrícula ("buscame alguien parecido"). Las búsquedas corren
						en segundo plano y los resultados quedan en la lupa.
					</p>
				{/if}
				{#each geminiChat.turns as turn, index (index)}
					{#if turn.role === "info"}
						<p
							class="self-center rounded-xl bg-secondary px-2.5 py-1 text-center text-2xs text-muted-foreground"
						>
							{turn.text}
						</p>
					{:else}
						<div
							class={[
								"max-w-[88%] rounded-2xl px-3 py-1.5 text-sm whitespace-pre-wrap",
								turn.role === "user"
									? "self-end bg-primary text-primary-foreground"
									: "self-start bg-card text-foreground",
							]}
						>
							{turn.text}
							{#if turn.role === "user" && turn.images !== undefined}
								<span class="block text-2xs opacity-70">
									{turn.images > 0
										? `con la pantalla · ${turn.images} ${turn.images === 1 ? "imagen" : "imágenes"}`
										: "con el texto de la pantalla"}
								</span>
							{/if}
						</div>
					{/if}
				{/each}
				{#if geminiChat.busy}
					<p class="self-start text-xs text-muted-foreground">
						Pensando…
					</p>
				{/if}
			</div>

			<div class="flex flex-col gap-1.5 border-t border-border px-3 py-2">
				<label class="flex items-center gap-2 text-2xs text-muted-foreground">
					<input
						type="checkbox"
						bind:checked={includeScreen}
						class="size-3.5"
					/>
					Mandar lo que hay en pantalla con la pregunta
				</label>
				<form
					class="flex items-end gap-2"
					onsubmit={(event) => {
						event.preventDefault();
						void send();
					}}
				>
					<textarea
						bind:value={draft}
						rows="1"
						placeholder="Preguntale a Gemini…"
						class="max-h-28 min-h-10 flex-1 resize-none rounded-xl bg-secondary px-3 py-2 text-base text-foreground"
						onkeydown={(event) => {
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								void send();
							}
						}}
					></textarea>
					<button
						type="submit"
						disabled={draft.trim() === "" ||
							geminiChat.busy ||
							!gemini.configured}
						class="h-10 shrink-0 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
					>
						Enviar
					</button>
				</form>
			</div>
		</div>
	{/if}
</div>
