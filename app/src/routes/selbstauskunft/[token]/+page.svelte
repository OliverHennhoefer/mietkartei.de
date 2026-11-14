<script lang="ts">
	import { enhance } from '$app/forms';
	import Money from '#lib/components/Money.svelte';
	import SelfDisclosureFields from '#lib/components/SelfDisclosureFields.svelte';
	import { formatDate } from '#lib/dates.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const sent = $derived(Boolean(form && 'sent' in form));
	const invalid = $derived(data.state === 'invalid' || Boolean(form && 'invalid' in form));
	const values = $derived<Record<string, string>>(
		(form && 'values' in form ? form.values : undefined) ??
			(data.state === 'open' ? data.values : {})
	);
	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
</script>

<svelte:head>
	<title>Mieterselbstauskunft | mietkartei</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="narrow wide-enough">
	<h1>Mieterselbstauskunft</h1>

	{#if sent || data.state === 'submitted'}
		<p>
			Vielen Dank! Ihre Angaben sind beim Vermieter angekommen. Sie können diese Seite schließen.
		</p>
	{:else if invalid || data.state !== 'open'}
		<p>
			Dieser Link gilt nicht mehr. Er ist abgelaufen, wurde schon benutzt oder die Wohnung ist
			vergeben. Bitte wenden Sie sich an den Vermieter, wenn Sie einen neuen Link brauchen.
		</p>
	{:else}
		<div class="card offer">
			<p>
				<strong>{data.offer.unit}</strong>, {data.offer.address}
			</p>
			<p>
				Kaltmiete <Money cents={data.offer.baseRent} />
				{#if data.offer.operatingCostPrepayment}
					· Betriebskosten <Money cents={data.offer.operatingCostPrepayment} />{/if}
				{#if data.offer.heatingCostPrepayment}
					· Heizkosten <Money cents={data.offer.heatingCostPrepayment} />{/if}
				{#if data.offer.availableFrom}· frei ab {formatDate(data.offer.availableFrom)}{/if}
			</p>
			<p class="muted">Vermieter: {data.landlordName}</p>
		</div>
		<p>
			Bitte füllen Sie aus, was Sie angeben möchten, und senden Sie das Formular einmal ab.
			Nachweise zum Einkommen oder zur Bonität brauchen Sie erst, wenn der Vermieter Ihnen die
			Wohnung anbieten möchte. Eine Kopie Ihres Ausweises ist nicht nötig.
		</p>
		<form method="POST" class="card" use:enhance>
			<SelfDisclosureFields {values} {errors} requiresWbs={data.offer.requiresWbs} applicant />
			<div class="form-actions form-wide">
				<button type="submit">Selbstauskunft absenden</button>
			</div>
		</form>
		<section class="notice">
			<h2>Datenschutzhinweis</h2>
			{#each data.notice as paragraph, index (index)}<p>{paragraph}</p>{/each}
		</section>
	{/if}
</div>

<style>
	.wide-enough {
		max-width: 60rem;
	}
	.offer p {
		margin: 0.25rem 0;
	}
	.notice p {
		font-size: 0.9rem;
	}
</style>
