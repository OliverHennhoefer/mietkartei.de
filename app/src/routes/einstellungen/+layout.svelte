<script lang="ts">
	import SettingsFrame from '#lib/components/SettingsFrame.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<SettingsFrame>{@render children()}</SettingsFrame>
