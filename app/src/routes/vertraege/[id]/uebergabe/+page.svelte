<script lang="ts">
	import { page } from '$app/state';
	import Alert from '#lib/components/Alert.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import Field from '#lib/components/Field.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import PreviewLink from '#lib/components/PreviewLink.svelte';
	import { formatDate } from '#lib/dates.ts';
	import { protocolTitle } from '#lib/domain/handover.ts';
	import { formatNumber } from '#lib/format.ts';
	import { roomConditionLabels } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const slugs = { move_in: 'einzug', move_out: 'auszug' } as const;
	const base = $derived(`/vertraege/${data.lease.id}/uebergabe`);
	const errors = $derived<Partial<Record<string, string>>>(form?.errors ?? {});
	const sent = $derived<Record<string, string> | undefined>(form?.values);

	// The rows of the form: as sent back after a refusal, else as prefilled by the server.
	const startRooms = $derived(
		sent
			? Array.from({ length: data.maxRooms }, (_, index) => index + 1)
					.filter((row) => sent[`room${row}`] || sent[`roomNote${row}`])
					.map((row) => ({
						name: sent[`room${row}`] ?? '',
						condition: sent[`condition${row}`] || 'good',
						note: sent[`roomNote${row}`] ?? ''
					}))
			: (data.form?.rooms ?? []).map((room) => ({ ...room, note: room.note ?? '' }))
	);
	const startKeys = $derived(
		sent
			? Array.from({ length: data.maxKeys }, (_, index) => index + 1)
					.filter((row) => sent[`key${row}`])
					.map((row) => ({ label: sent[`key${row}`], count: sent[`keyCount${row}`] ?? '' }))
			: (data.form?.keys ?? []).map((key) => ({ ...key, count: String(key.count) }))
	);
	let addedRooms = $state(0);
	let addedKeys = $state(0);
	const roomRows = $derived(Math.min(data.maxRooms, Math.max(1, startRooms.length) + addedRooms));
	const keyRows = $derived(Math.min(data.maxKeys, startKeys.length + addedKeys));
	const rowNumbers = (count: number) => Array.from({ length: count }, (_, index) => index + 1);
	const value = (name: string, fallback: string | number | undefined) =>
		sent ? (sent[name] ?? '') : fallback === undefined ? '' : String(fallback);

	// The meters in use on the date as typed; a reading of another would be refused.
	let typedDate = $state<string>();
	const shownDate = $derived(typedDate ?? value('date', data.form?.date));
	const shownMeters = $derived(
		data.meters.filter(
			(meter) =>
				(!meter.installedAt || meter.installedAt <= shownDate) &&
				(!meter.removedAt || meter.removedAt >= shownDate)
		)
	);
</script>

<!-- The heading and tab bar come from +layout.svelte; this page is the "Übergabe" tab. -->
<h2 class="visually-hidden">Übergabe</h2>

{#if form?.message}
	<Alert tone="danger"><p>{form.message}</p></Alert>
{/if}

<p class="muted small">
	Halte beim Einzug und beim Auszug fest, in welchem Zustand die Räume sind, welche Schlüssel
	übergeben wurden und was die Zähler zeigen. Ausgedruckt und unterschrieben ist das Protokoll der
	Beleg, wenn es später um Schäden oder die Kaution geht. Die Zählerstände kommen auch zu den
	Zählern.
</p>

{#each ['move_in', 'move_out'] as const as kind (kind)}
	{@const protocol = data.protocols[kind]}
	<h2>{protocolTitle(kind)}</h2>
	{#if data.editing === kind && data.form}
		<!-- The query stays, so a refusal shows the form again. -->
		<form method="POST" action="?/save&{page.url.searchParams}" class="card form">
			<input type="hidden" name="art" value={slugs[kind]} />
			<Field label="Datum der Übergabe" error={errors.date}>
				<input
					name="date"
					type="date"
					defaultValue={value('date', data.form.date)}
					max={data.today}
					oninput={(event) => (typedDate = event.currentTarget.value)}
					aria-invalid={errors.date ? 'true' : undefined}
					required
				/>
			</Field>
			<Field label="Anwesend (optional)" error={errors.attendees}>
				<input
					name="attendees"
					defaultValue={value('attendees', data.form.attendees)}
					placeholder="z. B. Vermieterin, Mieter, Hausmeister"
				/>
			</Field>

			<fieldset class="rows form-wide">
				<legend>Räume</legend>
				{#each rowNumbers(roomRows) as row (row)}
					{@const room = startRooms[row - 1]}
					<div class="room">
						<Field label="Raum" error={errors[`room${row}`]}>
							<input name="room{row}" defaultValue={room?.name ?? ''} />
						</Field>
						<Field label="Zustand" error={errors[`condition${row}`]}>
							<select name="condition{row}">
								{#each Object.entries(roomConditionLabels) as [condition, label] (condition)}
									<option value={condition} selected={(room?.condition ?? 'good') === condition}
										>{label}</option
									>
								{/each}
							</select>
						</Field>
						<Field label="Bemerkung" error={errors[`roomNote${row}`]}>
							<input
								name="roomNote{row}"
								defaultValue={room?.note ?? ''}
								placeholder="z. B. Kratzer im Parkett am Fenster"
							/>
						</Field>
					</div>
				{/each}
				{#if roomRows < data.maxRooms}
					<button type="button" class="secondary small" onclick={() => (addedRooms += 1)}
						>Weiterer Raum</button
					>
				{/if}
			</fieldset>

			<fieldset class="rows form-wide">
				<legend>Schlüssel</legend>
				{#each rowNumbers(keyRows) as row (row)}
					{@const key = startKeys[row - 1]}
					<div class="key">
						<Field label="Schlüssel" error={errors[`key${row}`]}>
							<input name="key{row}" defaultValue={key?.label ?? ''} />
						</Field>
						<Field label="Anzahl" error={errors[`keyCount${row}`]}>
							<input name="keyCount{row}" inputmode="numeric" defaultValue={key?.count ?? ''} />
						</Field>
					</div>
				{/each}
				{#if keyRows < data.maxKeys}
					<button type="button" class="secondary small" onclick={() => (addedKeys += 1)}
						>Weiterer Schlüssel</button
					>
				{/if}
			</fieldset>

			{#if shownMeters.length > 0}
				<fieldset class="rows form-wide">
					<legend>Zählerstände</legend>
					{#each shownMeters as meter (meter.id)}
						<Field label="{meter.label} ({meter.unit})" error={errors[`reading-${meter.id}`]}>
							<input
								name="reading-{meter.id}"
								inputmode="decimal"
								defaultValue={value(`reading-${meter.id}`, data.form.readings[meter.id])}
							/>
						</Field>
					{/each}
				</fieldset>
			{/if}

			<div class="form-wide">
				<Field label="Bemerkungen und Vereinbarungen (optional)" error={errors.notes}>
					<textarea name="notes" rows="3" defaultValue={value('notes', data.form.notes)}></textarea>
				</Field>
			</div>
			<div class="form-actions">
				<button type="submit">Protokoll speichern</button>
				<a class="button secondary" href={base} data-sveltekit-reset="false">Abbrechen</a>
			</div>
		</form>
	{:else if protocol}
		<div class="card protocol">
			<p>
				Übergabe am {formatDate(protocol.date)}: {protocol.rooms.length}
				{protocol.rooms.length === 1
					? 'Raum'
					: 'Räume'}{#if protocol.rooms.some((room) => room.condition === 'damaged')}, Mängel in {protocol.rooms
						.filter((room) => room.condition === 'damaged')
						.map((room) => room.name)
						.join(', ')}{/if}{#if protocol.readings.length > 0}, Zählerstände {protocol.readings
						.map((reading) => `${formatNumber(reading.value)} ${reading.unit}`)
						.join(', ')}{/if}.
			</p>
			<div class="actions">
				<PreviewLink
					href="{base}/{slugs[kind]}"
					title="{protocolTitle(kind)} vom {formatDate(protocol.date)}"
					class="button secondary"><Icon name="file" size={14} /> Protokoll ansehen</PreviewLink
				>
				<a class="button secondary" href="?protokoll={slugs[kind]}">Bearbeiten</a>
				<ConfirmButton
					action="?/delete"
					label="Löschen"
					message="{protocolTitle(kind)} vom {formatDate(
						protocol.date
					)} löschen? Die Zählerstände bleiben bei den Zählern."
				>
					<input type="hidden" name="art" value={slugs[kind]} />
				</ConfirmButton>
			</div>
		</div>
	{:else}
		<p>
			<a class="button secondary" href="?protokoll={slugs[kind]}">Protokoll anlegen</a>
		</p>
	{/if}
{/each}

<style>
	.rows {
		border: 0;
		margin: 0;
		padding: 0;
	}
	.rows legend {
		padding: 0;
		font-weight: 600;
	}
	.room {
		display: grid;
		grid-template-columns: minmax(0, 2fr) minmax(0, 2fr) minmax(0, 4fr);
		gap: 0.75rem;
	}
	.key {
		display: grid;
		grid-template-columns: minmax(0, 3fr) minmax(0, 1fr);
		gap: 0.75rem;
	}
	@media (max-width: 40rem) {
		.room,
		.key {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	.protocol .actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
</style>
