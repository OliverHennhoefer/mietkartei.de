<script lang="ts">
	import Alert from '#lib/components/Alert.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<h2>Bankabruf</h2>

<Alert tone="danger"><p>{data.message}</p></Alert>

<p><a href="/bank/konten">Zurück zu den Konten</a></p>
