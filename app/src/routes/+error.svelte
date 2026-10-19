<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>Fehler · mietkartei</title>
</svelte:head>

<h1>{page.status === 404 ? 'Nicht gefunden' : 'Etwas ist schiefgelaufen'}</h1>
<p>{page.error?.message}</p>
<p><a href={resolve('/objekte')}>Zur Übersicht der Objekte</a></p>
