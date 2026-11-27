<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Alert from '#lib/components/Alert.svelte';
	import Field from '#lib/components/Field.svelte';
	import Money from '#lib/components/Money.svelte';
	import { dayOf, formatDate } from '#lib/dates.ts';
	import { formatFileSize } from '#lib/domain/documents.ts';
	import { MAX_DAMAGE_PHOTOS } from '#lib/domain/tenant-portal.ts';
	import { formatNumber } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const invalid = $derived(data.state === 'invalid' || Boolean(form && 'invalid' in form));
	const meterForm = $derived(form && 'which' in form && form.which === 'meter' ? form : undefined);
	const damageForm = $derived(
		form && 'which' in form && form.which === 'damage' ? form : undefined
	);
	const meterErrors = $derived<Record<string, string> | undefined>(
		meterForm && 'errors' in meterForm ? meterForm.errors : undefined
	);
	const meterValues = $derived<Record<string, string>>(
		(meterForm && 'values' in meterForm ? meterForm.values : undefined) ?? {}
	);
	const damageErrors = $derived<Record<string, string> | undefined>(
		damageForm && 'errors' in damageForm ? damageForm.errors : undefined
	);
	const damageValues = $derived<Record<string, string>>(
		(damageForm && 'values' in damageForm ? damageForm.values : undefined) ?? {}
	);
	const base = $derived(`/mieterportal/${page.params.token}`);

	const balanceText = (balance: number) =>
		balance > 0 ? 'Nachzahlung' : balance < 0 ? 'Guthaben' : 'ausgeglichen';
</script>

<svelte:head>
	<title>Mieterportal | mietkartei</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="narrow wide-enough">
	<h1>Mieterportal</h1>

	{#if invalid || data.state !== 'open'}
		<p>
			Dieser Link gilt nicht mehr. Der Vermieter hat ihn ersetzt oder gesperrt, oder der Mietvertrag
			ist seit über einem Jahr beendet. Bitte wenden Sie sich an den Vermieter, wenn Sie einen neuen
			Link brauchen.
		</p>
	{:else}
		{@const view = data.view}
		<div class="card lease">
			<p><strong>{view.unit}</strong>, {view.address}</p>
			{#if view.tenants.length}<p>Mieter: {view.tenants.join(', ')}</p>{/if}
			<p class="muted">Vermieter: {view.landlord.name}</p>
			{#if view.openUntil}
				<p class="muted">Dieser Link gilt bis zum {formatDate(view.openUntil)}.</p>
			{/if}
		</div>

		<h2>Abrechnungen</h2>
		{#if view.statements.length === 0}
			<p class="muted">Noch keine Betriebskostenabrechnung.</p>
		{:else}
			<ul class="list card">
				{#each view.statements as statement (statement.id)}
					<li>
						<a href="{base}/abrechnungen/{statement.id}" target="_blank" rel="noopener"
							>Betriebskostenabrechnung {statement.period}{statement.version > 1
								? ` (Korrektur ${statement.version - 1})`
								: ''}</a
						>
						<span class="muted small">
							{balanceText(statement.balance)}
							{#if statement.balance !== 0}<Money cents={Math.abs(statement.balance)} />{/if}
							· erhalten am {formatDate(statement.deliveredOn)}
						</span>
					</li>
				{/each}
			</ul>
		{/if}

		<h2>Dokumente</h2>
		{#if view.documents.length === 0}
			<p class="muted">Der Vermieter hat noch keine Dokumente freigegeben.</p>
		{:else}
			<ul class="list card">
				{#each view.documents as document (document.id)}
					<li>
						<a href="{base}/dokumente/{document.id}?inline=1" target="_blank" rel="noopener"
							>{document.name}</a
						>
						<span class="muted small"
							>{formatFileSize(document.size)} · {formatDate(dayOf(document.createdAt))}</span
						>
					</li>
				{/each}
			</ul>
		{/if}

		{#if view.meters.length > 0}
			<h2>Zählerstand melden</h2>
			{#if meterForm && 'sent' in meterForm}
				<Alert tone="success"
					><p>Vielen Dank! Der Vermieter prüft den Zählerstand und übernimmt ihn.</p></Alert
				>
			{/if}
			<form
				method="POST"
				action="?/meter"
				class="card"
				enctype="multipart/form-data"
				use:enhance={() =>
					({ update }) =>
						update({ reset: true })}
			>
				<Field label="Zähler" error={meterErrors?.meterId}>
					<select name="meterId" required>
						{#each view.meters as meter (meter.id)}
							<option value={meter.id} selected={meterValues.meterId === meter.id}
								>{meter.label}{meter.unitName ? ` · ${meter.unitName}` : ''}{meter.location
									? ` · ${meter.location}`
									: ''}</option
							>
						{/each}
					</select>
				</Field>
				<Field label="Abgelesen am" error={meterErrors?.readAt}>
					<input
						name="readAt"
						type="date"
						required
						max={data.today}
						defaultValue={meterValues.readAt ?? data.today}
					/>
				</Field>
				<Field label="Zählerstand" error={meterErrors?.value}>
					<input name="value" inputmode="decimal" required defaultValue={meterValues.value ?? ''} />
				</Field>
				<Field label="Foto vom Zähler (freiwillig)" error={meterErrors?.photo}>
					<input name="photo" type="file" accept="image/*" capture="environment" />
				</Field>
				<Field label="Bemerkung (freiwillig)" error={meterErrors?.note}>
					<input name="note" maxlength="500" defaultValue={meterValues.note ?? ''} />
				</Field>
				<div class="form-actions form-wide">
					<button type="submit">Zählerstand senden</button>
				</div>
			</form>
			{#if view.pendingReadings.length > 0}
				<p class="muted small">
					Gemeldet, noch nicht übernommen:
					{#each view.pendingReadings as reading, index (reading.id)}{index > 0
							? '; '
							: ''}{reading.meter}
						{formatNumber(reading.value)}
						{reading.unit} am {formatDate(reading.readAt)}{/each}
				</p>
			{/if}
		{/if}

		<h2>Schaden melden</h2>
		{#if damageForm && 'sent' in damageForm}
			<Alert tone="success">
				<p>Vielen Dank! Die Meldung ist beim Vermieter angekommen.</p>
				{#if damageForm.photosMissing}
					<p>
						{damageForm.photosMissing === 1
							? 'Ein Foto ließ'
							: `${damageForm.photosMissing} Fotos ließen`}
						sich nicht speichern. Bitte schicken Sie es dem Vermieter auf anderem Weg.
					</p>
				{/if}
			</Alert>
		{/if}
		<p class="muted">
			Bei einem Notfall wie einem Wasserrohrbruch, Gasgeruch oder einem Stromausfall rufen Sie bitte
			sofort den Vermieter oder den Notdienst an.
		</p>
		<form
			method="POST"
			action="?/damage"
			class="card"
			enctype="multipart/form-data"
			use:enhance={() =>
				({ update }) =>
					update({ reset: true })}
		>
			<Field label="Was ist kaputt?" error={damageErrors?.title}>
				<input
					name="title"
					required
					maxlength="100"
					placeholder="z. B. Wasserhahn in der Küche tropft"
					defaultValue={damageValues.title ?? ''}
				/>
			</Field>
			<Field label="Ihr Name" error={damageErrors?.reporter}>
				<input
					name="reporter"
					required
					maxlength="100"
					autocomplete="name"
					defaultValue={damageValues.reporter ?? ''}
				/>
			</Field>
			<div class="form-wide">
				<Field label="Beschreibung" error={damageErrors?.description}>
					<textarea name="description" rows="4" required maxlength="2000"
						>{damageValues.description ?? ''}</textarea
					>
				</Field>
			</div>
			<Field label="Telefon für Rückfragen (freiwillig)" error={damageErrors?.phone}>
				<input
					name="phone"
					type="tel"
					maxlength="40"
					autocomplete="tel"
					defaultValue={damageValues.phone ?? ''}
				/>
			</Field>
			<Field label="Fotos (freiwillig, bis zu {MAX_DAMAGE_PHOTOS})" error={damageErrors?.photos}>
				<input name="photos" type="file" accept="image/*" multiple />
			</Field>
			<div class="form-actions form-wide">
				<button type="submit">Schaden melden</button>
			</div>
		</form>
		{#if view.damages.length > 0}
			<ul class="list card">
				{#each view.damages as damage (damage.id)}
					<li>
						<span>{damage.title.replace(/^Schaden: /, '')}</span>
						<span class="muted small"
							>gemeldet am {formatDate(dayOf(damage.reportedAt))} · {damage.done
								? 'erledigt'
								: 'in Bearbeitung'}</span
						>
					</li>
				{/each}
			</ul>
		{/if}

		<section class="notice">
			<h2>Datenschutzhinweis</h2>
			{#each data.notice as paragraph, index (index)}<p>{paragraph}</p>{/each}
		</section>
	{/if}
	<!-- Hosted, mietkartei runs the page and names its Impressum; a self-hosted instance has another
	     operator, so it only credits the software. -->
	<footer class="guest-footer">
		{#if data.hosted}
			Bereitgestellt mit <a href="https://mietkartei.de">mietkartei</a> ·
			<a href="https://mietkartei.de/impressum/">Impressum</a> ·
			<a href="https://mietkartei.de/datenschutz/">Datenschutz</a>
		{:else}
			Erstellt mit <a href="https://mietkartei.de">mietkartei</a>
		{/if}
	</footer>
</div>

<style>
	.wide-enough {
		max-width: 60rem;
	}
	.lease p {
		margin: 0.25rem 0;
	}
	.list {
		list-style: none;
		padding: 0.5rem 1rem;
	}
	.list li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		justify-content: space-between;
		padding: 0.5rem 0;
	}
	.list li + li {
		border-top: 1px solid var(--color-border);
	}
	.notice p {
		font-size: 0.9rem;
	}
	.guest-footer {
		margin: 3rem 0 1.5rem;
		padding-top: 1rem;
		border-top: 1px solid var(--color-border);
		font-size: 0.85rem;
		color: var(--color-muted);
	}
</style>
