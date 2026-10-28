<script lang="ts">
	import { enhance } from '$app/forms';
	import Badge from '#lib/components/Badge.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import EditDialog from '#lib/components/EditDialog.svelte';
	import { formatDate, today } from '#lib/dates.ts';
	import { defaultMeterUnit } from '#lib/domain/operating-costs.ts';
	import { formatNumber } from '#lib/format.ts';
	import { meterKindLabels } from '#lib/labels.ts';
	import type { MeterKind } from '#lib/server/db/schema.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// The kinds come from the labels: schema.ts is server-only code.
	const meterKinds = Object.keys(meterKindLabels) as MeterKind[];

	const meterForm = $derived(form?.form === 'meter' ? form : undefined);
	const readingForm = $derived(form?.form === 'reading' ? form : undefined);
	const removalForm = $derived(form?.form === 'removal' ? form : undefined);
	const editForm = $derived(form?.form === 'editReading' ? form : undefined);
	// After a refused save the typed values win; otherwise the dialog shows the reading as stored.
	const editValues = $derived(
		editForm?.values ??
			(data.editing && {
				readAt: data.editing.readAt,
				value: String(data.editing.value).replace('.', ','),
				note: data.editing.note ?? '',
				estimated: data.editing.estimated ? 'on' : ''
			})
	);

	// Building meters first, then one group per unit, in the order the server sorted them.
	const groups = $derived.by(() => {
		const list: { unitId: string | null; label: string; meters: typeof data.meters }[] = [];
		for (const meter of data.meters) {
			let group = list.find((candidate) => candidate.unitId === meter.unitId);
			if (!group) {
				group = { unitId: meter.unitId, label: meter.unitName ?? 'Gebäude', meters: [] };
				list.push(group);
			}
			group.meters.push(meter);
		}
		return list;
	});

	const base = $derived(`/objekte/${data.property.id}/zaehler`);
	/** The tab's URL with the unit filter kept and, optionally, a meter expanded. */
	const withUnit = (meterId?: string) => {
		const parts = [];
		if (data.filterUnit) parts.push(`unit=${encodeURIComponent(data.filterUnit.id)}`);
		if (meterId) parts.push(`meter=${encodeURIComponent(meterId)}`);
		return parts.length > 0 ? `${base}?${parts.join('&')}` : base;
	};
	/**
	 * A form action that keeps the filter and the expanded meter in the URL: a failed submission
	 * re-renders the page at the action's URL, so the query has to be part of it.
	 */
	const actionOn = (name: string, meterId?: string) => {
		const href = withUnit(meterId);
		return `${href}${href.includes('?') ? '&' : '?'}/${name}`;
	};

	// svelte-ignore state_referenced_locally
	let newMeterKind: MeterKind = $state((meterForm?.values.kind as MeterKind | undefined) ?? 'heat');
	const meterValue = (name: string, fallback = '') => meterForm?.values[name] ?? fallback;
</script>

<!-- The heading and tab bar come from the layout; this page is the "Zähler" tab. -->
<h2 class="visually-hidden">Zähler</h2>
<p class="muted">
	Zähler des Gebäudes und der Einheiten mit ihren Zählerständen. Ein ausgetauschter Zähler wird
	ausgebaut und der neue angelegt; die Abrechnung rechnet den Verbrauch je Einheit zusammen.
</p>

<div class="toolbar">
	<span class="muted">Einheit:</span>
	<a href={base} aria-current={data.filterUnit ? undefined : 'page'}>alle</a>
	{#each data.units as unit (unit.id)}
		<a
			href="{base}?unit={unit.id}"
			aria-current={data.filterUnit?.id === unit.id ? 'page' : undefined}
		>
			{unit.name}
		</a>
	{/each}
</div>

{#if data.meters.length === 0}
	<p>
		{data.filterUnit
			? `${data.filterUnit.name} hat noch keine Zähler.`
			: 'Dieses Objekt hat noch keine Zähler.'}
	</p>
{/if}

{#each groups as group (group.unitId ?? '')}
	<h3>{group.label}</h3>
	<div class="table-wrap">
		<table class="table" aria-label="Zähler {group.label}">
			<thead>
				<tr>
					<th>Art</th>
					<th>Zählernummer</th>
					<th>Einheit</th>
					<th>Standort</th>
					<th>Eingebaut</th>
					<th>Ausgebaut</th>
					<th>Letzter Stand</th>
					<th class="actions">Aktionen</th>
				</tr>
			</thead>
			<tbody>
				{#each group.meters as meter (meter.id)}
					<tr>
						<td>{meterKindLabels[meter.kind]}</td>
						<td>{meter.serialNumber ?? '–'}</td>
						<td>{meter.unit}</td>
						<td>{meter.location ?? '–'}</td>
						<td>{meter.installedAt ? formatDate(meter.installedAt) : '–'}</td>
						<td>{meter.removedAt ? formatDate(meter.removedAt) : '–'}</td>
						<td>
							{#if meter.lastReading}
								{formatNumber(meter.lastReading.value)}
								{meter.unit} am {formatDate(meter.lastReading.readAt)}
								{#if meter.lastReading.estimated}<Badge tone="warning">geschätzt</Badge>{/if}
							{:else}
								<span class="muted">noch kein Stand</span>
							{/if}
						</td>
						<td class="actions">
							<a class="button secondary small" href={withUnit(meter.id)}>Stände</a>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/each}

{#if data.expanded}
	{@const meter = data.expanded}
	<section class="card stack" aria-label="Zählerstände">
		<div class="row between">
			<h3 class="no-margin">
				Zählerstände {meterKindLabels[meter.kind]}
				{meter.serialNumber ?? ''}
				<span class="muted">({meter.unitName ?? 'Gebäude'})</span>
			</h3>
			<a href={withUnit()}>Schließen</a>
		</div>

		{#if data.readings.length === 0}
			<p class="muted">Noch kein Zählerstand erfasst.</p>
		{:else}
			<div class="table-wrap">
				<table
					class="table"
					aria-label="Zählerstände von {meterKindLabels[meter.kind]} {meter.serialNumber ?? ''}"
				>
					<thead>
						<tr>
							<th>Datum</th>
							<th class="num">Stand ({meter.unit})</th>
							<th></th>
							<th>Notiz</th>
						</tr>
					</thead>
					<tbody>
						{#each data.readings as reading (reading.id)}
							<tr>
								<td>
									<a
										href="{withUnit(meter.id)}&bearbeiten={reading.id}"
										data-sveltekit-reset="false">{formatDate(reading.readAt)}</a
									>
								</td>
								<td class="num">{formatNumber(reading.value)}</td>
								<td
									>{#if reading.estimated}<Badge tone="warning">geschätzt</Badge>{/if}</td
								>
								<td>{reading.note ?? ''}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<h4 class="no-margin">Zählerstand erfassen</h4>
		<form method="POST" action={actionOn('createReading', meter.id)} class="form" use:enhance>
			<input type="hidden" name="meterId" value={meter.id} />
			<input type="hidden" name="filterUnit" value={data.filterUnit?.id ?? ''} />
			{@render readingFields(
				meter.unit,
				readingForm?.values ?? { readAt: today() },
				readingForm?.errors
			)}
			<div class="form-actions">
				<button type="submit">Zählerstand erfassen</button>
			</div>
		</form>

		<div class="row between">
			<form method="POST" action={actionOn('removeMeter', meter.id)} class="row" use:enhance>
				<input type="hidden" name="meterId" value={meter.id} />
				<input type="hidden" name="filterUnit" value={data.filterUnit?.id ?? ''} />
				<label>
					Ausgebaut am
					<input
						type="date"
						name="removedAt"
						defaultValue={removalForm?.values.removedAt ?? meter.removedAt ?? today()}
						aria-invalid={removalForm?.errors.removedAt ? 'true' : undefined}
						required
					/>
					{#if removalForm?.errors.removedAt}<span class="error"
							>{removalForm.errors.removedAt}</span
						>{/if}
				</label>
				<button type="submit" class="secondary">Zähler ausbauen</button>
			</form>
			<ConfirmButton
				action={actionOn('deleteMeter', meter.id)}
				label="Zähler löschen"
				message="Zähler {meterKindLabels[meter.kind]} {meter.serialNumber ??
					''} mit allen Zählerständen wirklich löschen?"
			>
				<input type="hidden" name="meterId" value={meter.id} />
				<input type="hidden" name="filterUnit" value={data.filterUnit?.id ?? ''} />
			</ConfirmButton>
		</div>
		<p class="muted small">Beim Löschen werden alle Zählerstände des Zählers mit gelöscht.</p>
	</section>
{/if}

<h2>Zähler anlegen</h2>
<form method="POST" action={actionOn('createMeter')} class="card" use:enhance>
	<input type="hidden" name="filterUnit" value={data.filterUnit?.id ?? ''} />
	<label>
		Einheit
		<select name="unitId" aria-invalid={meterForm?.errors.unitId ? 'true' : undefined}>
			<option value="" selected={meterValue('unitId', data.filterUnit?.id ?? '') === ''}>
				Gebäude (keine Einheit)
			</option>
			{#each data.units as unit (unit.id)}
				<option
					value={unit.id}
					selected={meterValue('unitId', data.filterUnit?.id ?? '') === unit.id}
				>
					{unit.name}
				</option>
			{/each}
		</select>
		{#if meterForm?.errors.unitId}<span class="error">{meterForm.errors.unitId}</span>{/if}
	</label>
	<label>
		Art
		<select
			name="kind"
			bind:value={newMeterKind}
			aria-invalid={meterForm?.errors.kind ? 'true' : undefined}
			required
		>
			{#each meterKinds as kind (kind)}
				<option value={kind}>{meterKindLabels[kind]}</option>
			{/each}
		</select>
		{#if meterForm?.errors.kind}<span class="error">{meterForm.errors.kind}</span>{/if}
	</label>
	<label>
		Zählernummer (optional)
		<input
			name="serialNumber"
			defaultValue={meterValue('serialNumber')}
			aria-invalid={meterForm?.errors.serialNumber ? 'true' : undefined}
		/>
		{#if meterForm?.errors.serialNumber}<span class="error">{meterForm.errors.serialNumber}</span
			>{/if}
	</label>
	<label>
		Einheit der Messung
		{#key newMeterKind}
			<input
				name="unit"
				defaultValue={meterForm?.values.unit ?? defaultMeterUnit(newMeterKind)}
				aria-invalid={meterForm?.errors.unit ? 'true' : undefined}
				required
			/>
		{/key}
		{#if meterForm?.errors.unit}<span class="error">{meterForm.errors.unit}</span>{/if}
	</label>
	<label>
		Standort (optional)
		<input
			name="location"
			defaultValue={meterValue('location')}
			placeholder="z. B. Keller, Flur"
			aria-invalid={meterForm?.errors.location ? 'true' : undefined}
		/>
		{#if meterForm?.errors.location}<span class="error">{meterForm.errors.location}</span>{/if}
	</label>
	<label>
		Eingebaut am (optional)
		<input
			type="date"
			name="installedAt"
			defaultValue={meterValue('installedAt')}
			aria-invalid={meterForm?.errors.installedAt ? 'true' : undefined}
		/>
		{#if meterForm?.errors.installedAt}<span class="error">{meterForm.errors.installedAt}</span
			>{/if}
	</label>
	<div class="form-actions">
		<button type="submit">Zähler anlegen</button>
	</div>
</form>

{#snippet readingFields(
	unit: string,
	values: Record<string, string>,
	errors: Partial<Record<string, string>> | undefined
)}
	<label>
		Abgelesen am
		<input
			type="date"
			name="readAt"
			defaultValue={values.readAt ?? ''}
			aria-invalid={errors?.readAt ? 'true' : undefined}
			required
		/>
		{#if errors?.readAt}<span class="error">{errors.readAt}</span>{/if}
	</label>
	<label>
		Stand in {unit}
		<input
			name="value"
			inputmode="decimal"
			defaultValue={values.value ?? ''}
			aria-invalid={errors?.value ? 'true' : undefined}
			required
		/>
		{#if errors?.value}<span class="error">{errors.value}</span>{/if}
	</label>
	<label>
		Notiz (optional)
		<input
			name="note"
			defaultValue={values.note ?? ''}
			aria-invalid={errors?.note ? 'true' : undefined}
		/>
		{#if errors?.note}<span class="error">{errors.note}</span>{/if}
	</label>
	<label class="inline">
		<input type="checkbox" name="estimated" checked={values.estimated === 'on'} />
		geschätzt (§ 9a HeizKV)
	</label>
{/snippet}

{#if data.editing && data.expanded && editValues}
	{#key data.editing.id}
		<EditDialog
			title="Zählerstand bearbeiten"
			action="?/updateReading"
			deleteAction="?/deleteReading"
			deleteMessage="Zählerstand vom {formatDate(data.editing.readAt)} wirklich löschen?"
			close={withUnit(data.expanded.id)}
		>
			<input type="hidden" name="meterId" value={data.expanded.id} />
			<input type="hidden" name="readingId" value={data.editing.id} />
			<input type="hidden" name="filterUnit" value={data.filterUnit?.id ?? ''} />
			{@render readingFields(data.expanded.unit, editValues, editForm?.errors)}
		</EditDialog>
	{/key}
{/if}

<style>
	.no-margin {
		margin: 0;
	}
	.toolbar a[aria-current='page'] {
		font-weight: 600;
	}
</style>
