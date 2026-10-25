<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Zugriff erlauben | mietkartei</title>
</svelte:head>

<!-- No use:enhance: the answer is a redirect to the app, which the browser follows itself. -->
<div class="narrow">
	<h1>Zugriff erlauben</h1>
	<p class="auth-lead">
		<strong>{data.client}</strong> möchte auf deine Daten in mietkartei zugreifen. Danach geht es
		weiter zu <strong>{data.host}</strong>.
	</p>

	<form method="POST" class="card">
		<p>
			Die App sieht alle Daten deines Kontos, auch die persönlichen Daten deiner Mieter, und handelt
			mit deinen Rechten. Erlaube den Zugriff nur, wenn du die Verbindung gerade selbst eingerichtet
			hast und <strong>{data.host}</strong> vertraust.
		</p>
		{#if data.scopes.length > 1}
			<label>
				Rechte
				<select name="scope">
					<option value="read" selected={data.scope === 'read'}>Nur lesen</option>
					<option value="write" selected={data.scope === 'write'}>Lesen und schreiben</option>
				</select>
			</label>
			<p class="muted">
				Zum Schreiben gehört nur: Zahlungen buchen, Aufgaben anlegen und erledigen, Belege erfassen.
				Löschen oder ändern kann die App nichts.
			</p>
		{:else}
			<input type="hidden" name="scope" value="read" />
			<p class="muted">Die App darf nur lesen.</p>
		{/if}
		<p class="muted">
			Du kannst die Verbindung jederzeit unter Einstellungen → KI-Assistenten trennen.
		</p>
		<div class="form-actions">
			<button type="submit" name="decision" value="approve">Erlauben</button>
			<button type="submit" name="decision" value="deny" class="secondary">Ablehnen</button>
		</div>
	</form>
</div>
