<script lang="ts">
	import { Input } from "$lib/components/ui/input";

	let {
		value = $bindable(),
		disabled = false,
		class: className,
	}: { value: string; disabled?: boolean; class?: string } = $props();

	const hintId = $props.id();
</script>

<div class={["flex flex-col gap-1.5", className]}>
	<Input
		bind:value
		placeholder="Nombre del álbum"
		aria-label="Nombre del álbum"
		aria-describedby={hintId}
		maxlength={255}
		{disabled}
	/>
	<p id={hintId} class="px-1 text-xs text-muted-foreground">
		Solo vos ves el nombre del álbum
	</p>
</div>
