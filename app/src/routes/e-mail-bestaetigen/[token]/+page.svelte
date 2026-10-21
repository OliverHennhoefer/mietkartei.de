<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Neue E-Mail-Adresse · mietkartei</title>
</svelte:head>

<div class="narrow">
	<h1>Neue E-Mail-Adresse</h1>

	{#if form?.taken}
		<p>
			Für {data.email} gibt es inzwischen ein anderes Zugangskonto. Deine Adresse bleibt, wie sie ist.
		</p>
	{:else}
		<p class="muted">
			Bestätige, dass {data.email} ab jetzt die E-Mail-Adresse deines Zugangs zu mietkartei ist. Danach
			bist du auf allen anderen Geräten abgemeldet.
		</p>
		<form method="POST" class="card" use:enhance>
			<div class="form-actions">
				<button type="submit">E-Mail-Adresse bestätigen</button>
			</div>
		</form>
	{/if}
</div>
