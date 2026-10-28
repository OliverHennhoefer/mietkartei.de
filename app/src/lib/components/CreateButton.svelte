<script lang="ts">
	import type { HTMLAnchorAttributes } from 'svelte/elements';
	import Icon from './Icon.svelte';

	// The link that starts creating something, always with a leading "+". In the actions of a
	// PageHeader it shrinks to the "+" alone on a narrow screen; the label stays for screen readers.
	let {
		href,
		label,
		secondary = false,
		...rest
	}: { href: string; label: string; secondary?: boolean } & HTMLAnchorAttributes = $props();
</script>

<a class="button create" class:secondary {href} {...rest}
	><Icon name="plus" size={16} /><span class="create-label">{label}</span></a
>
