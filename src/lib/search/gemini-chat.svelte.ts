// The Gemini bubble's conversation: free questions about what's on screen, and
// "find me profiles like…" requests that Gemini turns into a queued photo search
// over the grid thumbnails (see vision-queue).

import { gridState } from "$lib/grid/grid-state.svelte";
import { gemini, geminiEndpoint } from "./gemini-search.svelte";
import { captureScreen } from "./screen-capture";

export type ChatTurn = {
	role: "user" | "model" | "info";
	text: string;
	/** How many screen images went along with a user turn. */
	images?: number;
};

type Part = Record<string, unknown>;
type Content = { role: "user" | "model"; parts: Part[] };

const SEARCH_TOOL = "buscar_en_cuadricula";

const SYSTEM =
	"Sos un asistente integrado en una app de citas que el usuario está usando en su teléfono. " +
	"Respondé siempre en español rioplatense, claro y breve, sin formato markdown. " +
	"Cuando el mensaje trae «Pantalla actual», eso es el texto y las imágenes visibles en la pantalla del usuario en ese momento: usalos para responder. " +
	"Podés describir el aspecto de las personas que aparecen en las fotos (rasgos visibles, ropa, lugar), pero no intentes decir quién es una persona real ni adivinar datos privados. " +
	`Cuando el usuario pida buscar o encontrar perfiles por su aspecto (por ejemplo "buscame alguien parecido", "buscá morochos con barba"), llamá a la función ${SEARCH_TOOL} con una descripción visual corta y concreta de lo que hay que buscar en las fotos. ` +
	"Si pide alguien parecido a una persona que describiste antes, armá la descripción con los rasgos visibles de esa persona. " +
	"La búsqueda corre en segundo plano y sus resultados se ven en la lupa de la cuadrícula, no en este chat.";

const TOOLS = [
	{
		functionDeclarations: [
			{
				name: SEARCH_TOOL,
				description:
					"Encola una búsqueda entre las miniaturas de los perfiles cargados en la cuadrícula. Devuelve si quedó encolada.",
				parameters: {
					type: "OBJECT",
					properties: {
						descripcion: {
							type: "STRING",
							description:
								"Descripción visual corta de lo que hay que buscar en las fotos, por ejemplo: hombre de pelo oscuro, barba corta y tatuajes en el brazo.",
						},
					},
					required: ["descripcion"],
				},
			},
		],
	},
];

function runSearch(description: string): string {
	const query = description.trim();
	if (query === "") return "La descripción estaba vacía; no se encoló nada.";
	const outcome = gridState.queuePhotoSearch({
		query,
		radiusMetres: null,
		thumbs: true,
	});
	if (outcome === "added")
		return "Búsqueda encolada. Corre en segundo plano; los resultados se ven en la lupa de la cuadrícula.";
	if (outcome === "duplicate")
		return "Esa misma búsqueda ya estaba en la cola.";
	return "No hay perfiles cargados en la cuadrícula para revisar. El usuario tiene que abrir la cuadrícula primero.";
}

class GeminiChat {
	turns = $state<ChatTurn[]>([]);
	busy = $state(false);
	#history: Content[] = [];
	#generation = 0;

	clear(): void {
		this.#generation += 1;
		this.#history = [];
		this.turns = [];
		this.busy = false;
	}

	async ask(text: string, { includeScreen }: { includeScreen: boolean }) {
		const question = text.trim();
		if (question === "" || this.busy) return;
		if (!gemini.configured) {
			this.turns = [
				...this.turns,
				{
					role: "info",
					text: "Falta la clave de Gemini. Cargala en Configuración → App.",
				},
			];
			return;
		}
		const generation = this.#generation;
		this.busy = true;
		try {
			const parts: Part[] = [];
			let images = 0;
			if (includeScreen) {
				const screen = await captureScreen();
				images = screen.images.length;
				parts.push({
					text:
						`Pantalla actual (${location.pathname}).\nTexto visible:\n${screen.text || "(sin texto)"}\n` +
						(images > 0
							? `Siguen ${images} imágenes visibles, de la más grande a la más chica.`
							: "No hay imágenes visibles."),
				});
				for (const image of screen.images) parts.push({ inlineData: image });
			}
			parts.push({ text: question });
			if (generation !== this.#generation) return;
			this.turns = [...this.turns, { role: "user", text: question, images }];
			// Only the newest screen travels with the request; older screenshots
			// would just bloat it.
			for (const content of this.#history)
				content.parts = content.parts.map((part) =>
					"inlineData" in part ? { text: "[imagen anterior omitida]" } : part,
				);
			this.#history.push({ role: "user", parts });

			// A function call needs a second round to get the spoken answer.
			for (let round = 0; round < 3; round += 1) {
				const reply = await this.#request();
				if (generation !== this.#generation) return;
				if (reply === null) return;
				this.#history.push(reply);
				const call = reply.parts.find((part) => "functionCall" in part) as
					| { functionCall: { name?: string; args?: { descripcion?: string } } }
					| undefined;
				const spoken = reply.parts
					.map((part) => (typeof part.text === "string" ? part.text : ""))
					.join("")
					.trim();
				if (spoken !== "")
					this.turns = [...this.turns, { role: "model", text: spoken }];
				if (!call) {
					if (spoken === "")
						this.turns = [
							...this.turns,
							{ role: "info", text: "Gemini no devolvió respuesta." },
						];
					return;
				}
				const description = call.functionCall.args?.descripcion ?? "";
				const result = runSearch(description);
				this.turns = [
					...this.turns,
					{ role: "info", text: `🔍 «${description}» — ${result}` },
				];
				this.#history.push({
					role: "user",
					parts: [
						{
							functionResponse: {
								name: call.functionCall.name ?? SEARCH_TOOL,
								response: { resultado: result },
							},
						},
					],
				});
			}
		} catch (error) {
			console.error("[gemini-chat]", error);
			if (generation === this.#generation)
				this.turns = [
					...this.turns,
					{
						role: "info",
						text: "No se pudo hablar con Gemini. Revisá la conexión.",
					},
				];
		} finally {
			if (generation === this.#generation) this.busy = false;
		}
	}

	async #request(): Promise<Content | null> {
		const response = await fetch(geminiEndpoint(gemini.apiKey), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				systemInstruction: { parts: [{ text: SYSTEM }] },
				contents: this.#history,
				tools: TOOLS,
			}),
		});
		if (!response.ok) {
			const reason =
				response.status === 429
					? "Gemini está limitando los pedidos (cuota gratis). Probá en un minuto."
					: [400, 401, 403].includes(response.status)
						? `Gemini rechazó el pedido (${response.status}). Revisá la clave en Configuración.`
						: `Gemini respondió con un error (${response.status}).`;
			this.turns = [...this.turns, { role: "info", text: reason }];
			return null;
		}
		const json = (await response.json()) as {
			candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
			promptFeedback?: { blockReason?: string };
		};
		const parts = json.candidates?.[0]?.content?.parts;
		if (!parts || parts.length === 0) {
			const why =
				json.promptFeedback?.blockReason ??
				json.candidates?.[0]?.finishReason ??
				"sin motivo";
			this.turns = [
				...this.turns,
				{
					role: "info",
					text: `Gemini no quiso responder a esto (${why}).`,
				},
			];
			return null;
		}
		return { role: "model", parts };
	}
}

export const geminiChat = new GeminiChat();
