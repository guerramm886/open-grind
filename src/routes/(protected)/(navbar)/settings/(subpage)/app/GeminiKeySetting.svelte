<script lang="ts">
	import { toast } from "svelte-sonner";

	import { Button } from "$lib/components/ui/button";
	import Link from "$lib/components/ui/link/Link.svelte";
	import { gemini } from "$lib/search/gemini-search.svelte";

	let draft = $state(gemini.apiKey);
</script>

<div class="rounded-xl border p-4">
	<p class="text-base font-semibold">Búsqueda con IA (Gemini)</p>
	<p class="mt-1 text-2xs text-muted-foreground">
		Pegá tu clave de Gemini para buscar perfiles por lo que se ve en sus
		fotos, dentro de un radio. La clave queda solo en este teléfono. Es
		gratis: la sacás en <Link href="https://aistudio.google.com/apikey">
			Google AI Studio
		</Link>. Las fotos de los perfiles del radio se envían a Google para
		analizarlas.
	</p>
	<div class="mt-3 flex gap-2">
		<input
			type="password"
			autocomplete="off"
			placeholder="API key de Gemini"
			bind:value={draft}
			class="min-w-0 flex-1 rounded-lg bg-secondary px-3 py-2 text-base"
		/>
		<Button
			size="sm"
			onclick={() => {
				gemini.save(draft);
				toast.success(
					draft.trim() ? "Clave guardada" : "Clave borrada",
				);
			}}
		>
			Guardar
		</Button>
	</div>
</div>
