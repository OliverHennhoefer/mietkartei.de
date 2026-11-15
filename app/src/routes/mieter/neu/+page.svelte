<script lang="ts">
	import { setContext } from 'svelte';
	import Alert from '#lib/components/Alert.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import TenantForm from '#lib/components/TenantForm.svelte';
	import { personName } from '#lib/format.ts';
	import { FreshForm } from '#lib/fresh-form.svelte.ts';
	import type { PageProps } from './$types';

	// The form's groups are this page's sections, right under its title.
	setContext('form-heading-level', 2);

	let { data, form }: PageProps = $props();
	// "Speichern und nächsten Mieter" comes back here; the next tenant starts empty.
	const fresh = new FreshForm();
</script>

<PageHeader title="Mieter anlegen" back={{ href: '/mieter', label: 'Alle Mieter' }} />

{#if data.created && !form}
	<Alert tone="success">
		<p>
			{personName(data.created)} ist angelegt.
			<a href="/vertraege/neu?tenantId={data.created.id}">Mietvertrag anlegen</a>
		</p>
	</Alert>
{/if}

{#key fresh.visit}
	<TenantForm
		action="?/create"
		values={form?.values ?? {}}
		errors={form?.errors ?? {}}
		submitLabel="Mieter anlegen"
		nextLabel={data.returnTo ? null : 'Speichern und nächsten Mieter'}
		cancelHref={data.returnTo ?? '/mieter'}
		returnTo={data.returnTo}
	/>
{/key}
