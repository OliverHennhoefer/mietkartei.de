<script lang="ts">
	import PageHeader from '#lib/components/PageHeader.svelte';
	import TenantForm from '#lib/components/TenantForm.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<PageHeader title="Mieter anlegen" back={{ href: '/mieter', label: 'Alle Mieter' }} />

<TenantForm
	action="?/create"
	values={form?.values ?? {}}
	errors={form?.errors ?? {}}
	submitLabel="Mieter anlegen"
	cancelHref={data.returnTo ?? '/mieter'}
	returnTo={data.returnTo}
/>
