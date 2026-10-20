<script lang="ts">
	import LeaseForm from '#lib/components/LeaseForm.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<!-- The heading and tab bar come from +layout.svelte. -->
<h2>Mietvertrag bearbeiten</h2>

<LeaseForm
	mode="edit"
	action="?/update"
	values={form?.values ?? data.defaults}
	errors={form?.errors ?? {}}
	lease={data.lease}
	tenants={data.tenants}
	submitLabel="Speichern"
	cancelHref="/vertraege/{data.lease.id}"
/>
