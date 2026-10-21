<script lang="ts">
	import PageHeader from '#lib/components/PageHeader.svelte';
	import TenantForm from '#lib/components/TenantForm.svelte';
	import { personName } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// The tenant's columns as form strings; a failed submit shows what was typed instead.
	const defaults = $derived<Record<string, string>>({
		salutation: data.tenant.salutation ?? '',
		firstName: data.tenant.firstName,
		lastName: data.tenant.lastName,
		email: data.tenant.email ?? '',
		phone: data.tenant.phone ?? '',
		street: data.tenant.street ?? '',
		postalCode: data.tenant.postalCode ?? '',
		city: data.tenant.city ?? '',
		notes: data.tenant.notes ?? ''
	});
</script>

<PageHeader
	title="{personName(data.tenant)} bearbeiten"
	back={{ href: `/mieter/${data.tenant.id}`, label: personName(data.tenant) }}
/>

<TenantForm
	action="?/update"
	values={form?.values ?? defaults}
	errors={form?.errors ?? {}}
	submitLabel="Speichern"
	cancelHref="/mieter/{data.tenant.id}"
/>
