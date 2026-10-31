<script lang="ts">
	import { Button } from "$lib/components/ui/button";

	let {
		active,
		label,
		onclick,
		children,
	}: {
		active: boolean;
		label?: string;
		onclick: () => void;
		children: import("svelte").Snippet;
	} = $props();
</script>

<Button
	variant="secondary"
	aria-label={label}
	{onclick}
	class={{
		"neon-glow bg-primary text-primary-foreground hover:bg-primary/90": active,
	}}
>
	{@render children()}
</Button>
