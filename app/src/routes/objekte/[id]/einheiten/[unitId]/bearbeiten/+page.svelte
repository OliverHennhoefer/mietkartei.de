<script lang="ts">
	import { enhance } from '$app/forms';
	import PortfolioUnitFields from '#lib/components/PortfolioUnitFields.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<!-- The heading, address and tab bar come from +layout.svelte. -->
<h2>Einheit {data.unit.name} bearbeiten</h2>
<form method="POST" action="?/update" class="card" use:enhance>
	<PortfolioUnitFields values={form?.values} errors={form?.errors} unit={data.unit} />
	<div class="form-actions">
		<button type="submit">Speichern</button>
		<a href="/objekte/{data.property.id}/einheiten/{data.unit.id}">Abbrechen</a>
	</div>
</form>
