<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import Field from '#lib/components/Field.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { formatMonth } from '#lib/dates.ts';
	import { formatIndexValue } from '#lib/domain/index-rent.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	const values = $derived(form && 'values' in form ? form.values : undefined);
</script>

<PageHeader
	title="Verbraucherpreisindex"
	lead="Die Indexwerte, nach denen Indexmieten angepasst werden."
	back={{ href: '/einstellungen', label: 'Einstellungen' }}
/>

<Alert tone="info">
	<p>
		Die Werte stammen vom Statistischen Bundesamt (Destatis): Verbraucherpreisindex für Deutschland,
		Basisjahr 2020 = 100. Du trägst sie von Hand ein; ein Abruf ist nicht eingebaut. Für einen
		Vorschlag zählt der neueste Monat.
	</p>
</Alert>

<h2>Werte</h2>
{#if form && 'deleted' in form}
	<Alert tone="success"><p>Der Wert wurde gelöscht.</p></Alert>
{/if}
{#if data.values.length === 0}
	<p>Noch keine Werte eingetragen.</p>
{:else}
	<div class="table-wrap">
		<table class="table" aria-label="VPI-Werte">
			<thead>
				<tr>
					<th>Monat</th>
					<th class="num">Wert</th>
					<th>Basisjahr</th>
					<th class="actions"></th>
				</tr>
			</thead>
			<tbody>
				{#each data.values as value (value.id)}
					<tr>
						<td>{formatMonth(value.month)}</td>
						<td class="num">{formatIndexValue(value.value)}</td>
						<td>{value.baseYear}</td>
						<td class="actions">
							<ConfirmButton
								action="?/delete"
								label="Löschen"
								message="Den Wert für {formatMonth(value.month)} löschen?"
							>
								<input type="hidden" name="id" value={value.id} />
							</ConfirmButton>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<h2>Wert eintragen</h2>
{#if form && 'refusal' in form}
	<Alert tone="danger"><p>{form.refusal}</p></Alert>
{:else if form && 'added' in form && form.added}
	<Alert tone="success"><p>Der Wert für {formatMonth(form.added)} wurde eingetragen.</p></Alert>
{/if}
<form method="POST" action="?/add" class="card" use:enhance>
	<Field label="Monat" error={errors?.month}>
		<input
			type="month"
			name="month"
			defaultValue={values?.month ?? ''}
			aria-invalid={errors?.month ? 'true' : undefined}
			required
		/>
	</Field>
	<Field label="Indexwert" error={errors?.value} hint="Mit einer Nachkommastelle, z. B. 124,3">
		<input
			name="value"
			inputmode="decimal"
			defaultValue={values?.value ?? ''}
			aria-invalid={errors?.value ? 'true' : undefined}
			required
		/>
	</Field>
	<Field label="Basisjahr" error={errors?.baseYear}>
		<input
			name="baseYear"
			inputmode="numeric"
			defaultValue={values?.baseYear ?? '2020'}
			aria-invalid={errors?.baseYear ? 'true' : undefined}
			required
		/>
	</Field>
	<div class="form-actions">
		<button type="submit">Wert eintragen</button>
	</div>
</form>
