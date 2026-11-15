<script lang="ts">
	import { setContext } from 'svelte';
	import { enhance } from '$app/forms';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import PortfolioPropertyFields from '#lib/components/PortfolioPropertyFields.svelte';
	import type { PageProps } from './$types';

	// The form's groups are this page's sections, right under its title.
	setContext('form-heading-level', 2);

	let { form }: PageProps = $props();
</script>

<PageHeader title="Objekt anlegen" back={{ href: '/objekte', label: 'Alle Objekte' }} />

<form method="POST" action="?/create" class="card" use:enhance>
	<PortfolioPropertyFields values={form?.values} errors={form?.errors} />
	<div class="form-actions">
		<button type="submit">Objekt anlegen</button>
		<a href="/objekte">Abbrechen</a>
	</div>
</form>
