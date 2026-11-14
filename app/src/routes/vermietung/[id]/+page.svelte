<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import Badge from '#lib/components/Badge.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import EditDialog from '#lib/components/EditDialog.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Field from '#lib/components/Field.svelte';
	import LettingFields from '#lib/components/LettingFields.svelte';
	import Money from '#lib/components/Money.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import PreviewLink from '#lib/components/PreviewLink.svelte';
	import SortHeader from '#lib/components/SortHeader.svelte';
	import { formatDate } from '#lib/dates.ts';
	import { burdenTone, RETENTION_MONTHS } from '#lib/domain/applicants.ts';
	import { formatNumber } from '#lib/format.ts';
	import { applicantStatusLabels } from '#lib/labels.ts';
	import { byDate, byNumber, bySeverity, byText, TableSort } from '#lib/table-sort.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const letting = $derived(data.letting);
	const base = $derived(`/vermietung/${letting.id}`);
	const open = $derived(!letting.closedAt);
	const viewer = $derived(data.role === 'viewer');
	const editRefused = $derived(form && 'edit' in form ? form : undefined);
	const errors = $derived<Partial<Record<string, string>> | undefined>(
		form && 'errors' in form && !editRefused ? form.errors : undefined
	);
	const values = $derived<Record<string, string> | undefined>(
		form && 'values' in form && !editRefused ? form.values : undefined
	);

	type Row = PageProps['data']['applicants'][number];
	const statusOrder = [
		'accepted',
		'shortlisted',
		'applied',
		'viewing',
		'new',
		'withdrawn',
		'rejected'
	];
	const sort = new TableSort<Row>({
		name: byText((row) => row.name),
		status: bySeverity((row) => statusOrder.length - statusOrder.indexOf(row.status)),
		viewing: byDate((row) => row.viewingAt),
		household: byNumber((row) => row.household),
		income: byNumber((row) => row.netIncome),
		burden: byNumber((row) => row.burden),
		moveIn: byDate((row) => row.moveInDate),
		proofs: byNumber((row) => row.proofs.shown),
		rating: byNumber((row) => row.rating)
	});

	const statusTone = (status: Row['status']) =>
		status === 'accepted'
			? 'success'
			: status === 'shortlisted'
				? 'info'
				: status === 'rejected' || status === 'withdrawn'
					? 'neutral'
					: 'warning';

	function viewingLabel(viewingAt: string): string {
		return `${formatDate(viewingAt.slice(0, 10))}, ${viewingAt.slice(11)} Uhr`;
	}

	const percent = (share: number) => `${formatNumber(share * 100, 0)} %`;
</script>

<PageHeader
	title="Neuvermietung {letting.unit.name}"
	back={{ href: '/vermietung', label: 'Neuvermietung' }}
>
	{#snippet actions()}
		{#if open && !viewer}<a
				class="button secondary"
				href="?bearbeiten=1"
				data-sveltekit-reset="false">Bearbeiten</a
			>{/if}
	{/snippet}
</PageHeader>

{#if form && 'closed' in form}
	<Alert tone="success">
		<p>
			Die Neuvermietung ist abgeschlossen. Alle offenen Interessenten haben den Status Absage; ihre
			Angaben werden in {RETENTION_MONTHS} Monaten gelöscht.
		</p>
	</Alert>
{/if}
{#if !data.landlordComplete && open}
	<Alert tone="warning">
		<p>
			Auf der Selbstauskunft steht ein Datenschutzhinweis mit dir als Verantwortlichem. Trage dafür
			unter <a href="/einstellungen/profil">Profil</a> deinen Namen und deine Anschrift als Vermieter
			ein.
		</p>
	</Alert>
{/if}

<div class="card">
	<dl class="details">
		<dt>Einheit</dt>
		<dd>
			<a href="/objekte/{letting.property.id}/einheiten/{letting.unit.id}">{letting.unit.name}</a>
			· {letting.property.name}
		</dd>
		<dt>Frei ab</dt>
		<dd>{letting.availableFrom ? formatDate(letting.availableFrom) : 'nach Absprache'}</dd>
		<dt>Kaltmiete</dt>
		<dd><Money cents={letting.baseRent} /></dd>
		<dt>Warmmiete</dt>
		<dd>
			<Money cents={data.warmRent} />
			<span class="muted small">mit Vorauszahlungen für Betriebs- und Heizkosten</span>
		</dd>
		<dt>Kaution</dt>
		<dd><Money cents={letting.securityDeposit} /></dd>
		{#if letting.requiresWbs}
			<dt>Förderung</dt>
			<dd>Wohnberechtigungsschein nötig</dd>
		{/if}
		{#if letting.notes}
			<dt>Notizen</dt>
			<dd class="notes">{letting.notes}</dd>
		{/if}
		<dt>Status</dt>
		<dd>
			{#if open}<Badge tone="info">Läuft</Badge>{:else}<Badge
					>Abgeschlossen am {formatDate(letting.closedAt!)}</Badge
				>
				<span class="muted small"
					>wird am {formatDate(data.deletesOn!)} mit allen Interessenten gelöscht</span
				>{/if}
		</dd>
	</dl>
</div>

<div class="toolbar">
	<PreviewLink href="{base}/selbstauskunft" title="Mieterselbstauskunft {letting.unit.name}"
		>Selbstauskunft als PDF zum Ausdrucken</PreviewLink
	>
</div>

<h2>Interessenten</h2>
{#if data.applicants.length === 0}
	<EmptyState
		title="Noch keine Interessenten"
		text="Trage Interessenten ein, sobald sie sich melden. Für jeden kannst du einen Link zur Selbstauskunft erstellen, die er dann selbst ausfüllt."
	/>
{:else}
	<p class="muted">
		Die Mietbelastung ist der Anteil der Warmmiete am Nettoeinkommen des Haushalts. Bis 30 % gilt
		als gut tragbar, über 40 % wird es eng.
	</p>
	<div class="table-wrap">
		<table class="table compare" aria-label="Interessenten">
			<thead>
				<tr>
					<SortHeader {sort} key="name">Name</SortHeader>
					<SortHeader {sort} key="status">Status</SortHeader>
					<SortHeader {sort} key="viewing">Besichtigung</SortHeader>
					<SortHeader {sort} key="household" class="num">Personen</SortHeader>
					<SortHeader {sort} key="income" class="num">Nettoeinkommen</SortHeader>
					<SortHeader {sort} key="burden" class="num">Mietbelastung</SortHeader>
					<th>Haustiere</th>
					<SortHeader {sort} key="moveIn">Einzug ab</SortHeader>
					<SortHeader {sort} key="proofs">Nachweise</SortHeader>
					<SortHeader {sort} key="rating">Bewertung</SortHeader>
				</tr>
			</thead>
			<tbody>
				{#each sort.rows(data.applicants) as row (row.id)}
					<tr class:decided={row.status === 'rejected' || row.status === 'withdrawn'}>
						<td>
							<a href="{base}/interessenten/{row.id}">{row.name}</a>
							{#if row.coName}<span class="muted small">mit {row.coName}</span>{/if}
						</td>
						<td>
							<Badge tone={statusTone(row.status)} icon={false}
								>{applicantStatusLabels[row.status]}</Badge
							>
							{#if row.insolvency}<Badge tone="danger" icon={false}>Insolvenz</Badge>{/if}
							{#if row.deletesOn}<span class="muted small"
									>gelöscht am {formatDate(row.deletesOn)}</span
								>{/if}
						</td>
						<td>{row.viewingAt ? viewingLabel(row.viewingAt) : '–'}</td>
						<td class="num">
							{row.household ?? '–'}{#if row.children}<span class="muted small">
									({row.children} {row.children === 1 ? 'Kind' : 'Kinder'})</span
								>{/if}
						</td>
						<td class="num"
							>{#if row.netIncome !== null}<Money cents={row.netIncome} />{:else}–{/if}</td
						>
						<td class="num">
							{#if row.burden !== null}<Badge tone={burdenTone(row.burden)} icon={false}
									>{percent(row.burden)}</Badge
								>{:else}–{/if}
						</td>
						<td>{row.pets ?? '–'}</td>
						<td>{row.moveInDate ? formatDate(row.moveInDate) : '–'}</td>
						<td>
							<Badge
								tone={row.proofs.shown === row.proofs.total ? 'success' : 'neutral'}
								icon={false}>{row.proofs.shown} von {row.proofs.total}</Badge
							>
						</td>
						<td aria-label={row.rating ? `${row.rating} von 5 Sternen` : 'keine Bewertung'}
							>{row.rating ? '★'.repeat(row.rating) + '☆'.repeat(5 - row.rating) : '–'}</td
						>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

{#if open && !viewer}
	<h2 id="interessent-anlegen">Interessent eintragen</h2>
	<form method="POST" action="?/addApplicant" class="card" use:enhance>
		<Field label="Vorname" error={errors?.firstName}>
			<input name="firstName" defaultValue={values?.firstName ?? ''} required />
		</Field>
		<Field label="Nachname" error={errors?.lastName}>
			<input name="lastName" defaultValue={values?.lastName ?? ''} required />
		</Field>
		<Field label="E-Mail (optional)" error={errors?.email}>
			<input name="email" type="email" defaultValue={values?.email ?? ''} />
		</Field>
		<Field label="Telefon (optional)" error={errors?.phone}>
			<input name="phone" type="tel" defaultValue={values?.phone ?? ''} />
		</Field>
		<Field label="Besichtigung (optional)" error={errors?.viewingAt}>
			<input name="viewingAt" type="datetime-local" defaultValue={values?.viewingAt ?? ''} />
		</Field>
		<Field label="Notiz (optional)" error={errors?.notes}>
			<input name="notes" defaultValue={values?.notes ?? ''} placeholder="z. B. über Inserat" />
		</Field>
		<div class="form-actions form-wide">
			<button type="submit">Interessent eintragen</button>
		</div>
		{#if form && 'added' in form}
			<p class="form-actions form-wide" role="status">
				{form.added} wurde eingetragen{form.viewing ? `, Besichtigung am ${form.viewing} Uhr` : ''}.
			</p>
		{/if}
	</form>
{/if}

{#if !viewer}
	<h2>{open ? 'Neuvermietung beenden' : 'Neuvermietung löschen'}</h2>
	{#if open}
		<p class="muted">
			Hast du einen Mieter gefunden, gib ihm auf seiner Seite die Zusage; dann wird er mit einem
			Klick zum Mieter mit Mietvertrag. Ohne Zusage beenden: Alle offenen Interessenten bekommen den
			Status Absage, und ihre Angaben werden nach {RETENTION_MONTHS} Monaten gelöscht.
		</p>
		<div class="toolbar">
			<ConfirmButton
				action="?/close"
				label="Ohne Zusage beenden"
				tone="secondary"
				message="Neuvermietung beenden? Alle offenen Interessenten bekommen den Status Absage."
			/>
		</div>
	{/if}
	<p class="muted">
		Löschen entfernt die Neuvermietung mit allen Interessenten und Selbstauskünften sofort.
	</p>
	<ConfirmButton
		action="?/delete"
		label="Neuvermietung löschen"
		message="Neuvermietung mit allen Interessenten und Selbstauskünften endgültig löschen?"
	/>
{/if}

{#if data.editing}
	<EditDialog title="Neuvermietung bearbeiten" action="?/update" close={base}>
		<LettingFields values={editRefused?.values ?? data.editing} errors={editRefused?.errors} />
	</EditDialog>
{/if}

<style>
	.notes {
		white-space: pre-line;
	}
	.decided td {
		color: var(--color-muted);
	}
</style>
