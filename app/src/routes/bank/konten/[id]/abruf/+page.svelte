<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import Field from '#lib/components/Field.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<h2>Bankabruf für „{data.bankAccount.name}“</h2>

<p>
	Statt Kontoauszüge herunterzuladen und zu importieren, holt mietkartei die Umsätze von
	{data.bankAccount.iban} selbst ab. Dafür gibst du den Zugriff einmal bei deiner Bank frei, über den
	lizenzierten Kontoinformationsdienst Enable Banking. mietkartei liest nur Umsätze, Überweisungen sind
	damit nicht möglich. Die Freigabe gilt je nach Bank 90 bis 180 Tage, danach erneuerst du sie hier.
</p>

{#if form?.message}
	<Alert tone="danger"><p>{form.message}</p></Alert>
{/if}

{#if data.unavailable}
	<Alert tone="warning">
		<p>Die Liste der Banken ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.</p>
	</Alert>
{:else}
	<form method="POST" action="?/start" class="card" use:enhance>
		<Field label="Bank">
			<select name="bank" required>
				<option value="" disabled selected={!data.selected}>Bank wählen</option>
				{#each data.banks as bank (bank)}
					<option value={bank} selected={bank === data.selected}>{bank}</option>
				{/each}
			</select>
		</Field>
		<div class="form-actions form-wide">
			<button type="submit">Weiter zur Bank</button>
			<a href="/bank/konten">Abbrechen</a>
		</div>
	</form>
{/if}
