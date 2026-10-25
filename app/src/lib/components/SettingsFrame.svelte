<script lang="ts">
	import type { Snippet } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import SettingsDialog from '#lib/components/SettingsDialog.svelte';
	import { settingsSectionOf, settingsSections } from '#lib/settings.ts';

	// A settings page opened by its own address (a link, a reload): the same dialog as over the
	// app, here over the empty workspace. Closing it leads to the overview.
	let { children }: { children: Snippet } = $props();
</script>

<SettingsDialog
	sections={settingsSections(page.data.role, page.data.billingEnabled)}
	current={settingsSectionOf(page.url.pathname)?.href}
	onclose={() => goto(resolve('/'))}
>
	{@render children()}
</SettingsDialog>
