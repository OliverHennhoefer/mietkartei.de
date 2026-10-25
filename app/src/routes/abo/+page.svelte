<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import Badge from '#lib/components/Badge.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { formatDate } from '#lib/dates.ts';
	import { subscriptionStatusLabels } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const tones = {
		free: 'success',
		trialing: 'info',
		active: 'success',
		past_due: 'warning',
		canceled: 'danger',
		expired: 'danger'
	} as const;
</script>

<PageHeader title="Abo" lead="Testphase, Abo und Zahlung über Stripe." />

{#if !data.owner}
	<p class="muted">Das Abo verwaltet der Vermieter des Kontos.</p>
{:else}
	{#if data.success}
		<Alert tone="success">
			<p>Danke! Sobald Stripe die Einrichtung bestätigt hat, erscheint dein Abo hier als aktiv.</p>
		</Alert>
	{/if}
	{#if form?.message}
		<Alert tone="danger"><p>{form.message}</p></Alert>
	{/if}

	<section class="card subscription" aria-labelledby="abo-stand">
		<h2 id="abo-stand">Stand</h2>
		<dl class="details">
			<dt>Status</dt>
			<dd>
				<Badge tone={tones[data.state]}>
					{data.state === 'free'
						? 'Kostenlos'
						: data.state === 'expired'
							? 'Testphase abgelaufen'
							: subscriptionStatusLabels[data.status]}
				</Badge>
			</dd>
			{#if data.state === 'trialing' && data.status === 'none'}
				<dt>Testphase bis</dt>
				<dd>{formatDate(data.trialEnd)} (noch {data.trialDaysLeft} Tage)</dd>
			{:else if data.state === 'expired'}
				<dt>Testphase endete am</dt>
				<dd>{formatDate(data.trialEnd)}</dd>
			{/if}
			{#if data.state === 'free'}
				<!-- A free account has no period and no price. -->
			{:else if data.currentPeriodEnd && (data.state === 'active' || data.status === 'trialing')}
				<dt>Bezahlt bis</dt>
				<dd>{formatDate(data.currentPeriodEnd)}</dd>
			{:else if data.currentPeriodEnd && data.state === 'canceled'}
				<dt>Beendet am</dt>
				<dd>{formatDate(data.currentPeriodEnd)}</dd>
			{/if}
			{#if data.state !== 'free' && data.price}
				<dt>Preis</dt>
				<dd>
					<mark class="highlight">{data.price}</mark>{#if data.founder}
						&nbsp;als Gründerpreis statt {data.founder.regularPrice}{/if}, jederzeit kündbar
				</dd>
			{/if}
			{#if data.yearlyPrice}
				<dt>Jahresabo</dt>
				<dd>{data.yearlyPrice}, kündbar zum Ende des Jahres</dd>
			{/if}
		</dl>

		{#if data.state === 'free'}
			<p>
				Dein Konto ist kostenlos freigeschaltet. Du brauchst kein Abo, und es gibt keine Testphase,
				die abläuft.
				{#if data.subscriptionRuns}Dein bisheriges Abo läuft noch; kündige es bei Stripe.{/if}
			</p>
		{:else if data.state === 'active'}
			<p>Dein Abo ist aktiv. Zahlungsart, Rechnungen und Kündigung verwaltest du bei Stripe.</p>
		{:else if data.state === 'trialing' && data.status === 'trialing'}
			<p>Dein Abo läuft in der Testphase und wird danach abgerechnet.</p>
		{:else if data.state === 'trialing'}
			<p>
				Du kannst mietkartei bis zum {formatDate(data.trialEnd)} kostenlos testen. Schließt du das Abo
				vorher ab, läuft die Testphase weiter und die erste Zahlung folgt erst danach.
			</p>
		{:else if data.state === 'past_due'}
			<p>
				Die letzte Zahlung ist fehlgeschlagen. Stripe versucht es erneut; prüfe deine Zahlungsart,
				damit dein Abo bestehen bleibt.
			</p>
		{:else if data.state === 'canceled'}
			<p>
				Dein Abo ist beendet.
				{#if data.required}Du kannst deine Daten lesen und exportieren, aber nichts mehr ändern.{/if}
				Mit einem neuen Abo geht es weiter.
			</p>
		{:else}
			<p>
				Deine Testphase ist abgelaufen.
				{#if data.required}Du kannst deine Daten lesen und exportieren, aber nichts mehr ändern.{/if}
				Mit einem Abo geht es weiter.
			</p>
		{/if}

		<div class="toolbar">
			{#if data.state === 'free'}
				{#if data.subscriptionRuns}
					<form method="POST" action="?/portal" use:enhance>
						<button type="submit">Abo verwalten</button>
					</form>
				{/if}
			{:else if data.state === 'active' || data.state === 'past_due' || data.status === 'trialing'}
				<form method="POST" action="?/portal" use:enhance>
					<button type="submit">Abo verwalten</button>
				</form>
			{:else}
				<form method="POST" action="?/checkout" use:enhance>
					<input type="hidden" name="plan" value="monthly" />
					<button type="submit" class="highlight">
						{data.yearlyPrice ? 'Monatlich abschließen' : 'Abo abschließen'}
					</button>
				</form>
				{#if data.yearlyPrice}
					<form method="POST" action="?/checkout" use:enhance>
						<input type="hidden" name="plan" value="yearly" />
						<button type="submit" class="secondary">Jährlich abschließen</button>
					</form>
				{/if}
				{#if data.hasSubscription}
					<form method="POST" action="?/portal" use:enhance>
						<button type="submit" class="secondary">Rechnungen bei Stripe</button>
					</form>
				{/if}
			{/if}
		</div>
		{#if data.founder}
			<p class="muted small founder">
				Der Gründerpreis gilt für das Monatsabo und bleibt dauerhaft, auch wenn du später neu
				abschließt.{#if data.founder.spotsLeft !== null}
					Noch {data.founder.spotsLeft} Plätze frei.{/if}
			</p>
		{/if}
		<p class="muted small">
			Die Zahlung läuft über Stripe; mietkartei speichert keine Zahlungsdaten.
		</p>
	</section>
{/if}

<style>
	.subscription {
		max-width: 45rem;
	}
	.subscription h2 {
		margin: 0 0 1.25rem;
	}
	.subscription dl {
		margin-bottom: 1.5rem;
	}
	.subscription p {
		margin: 0 0 1.25rem;
	}
	.subscription .toolbar {
		margin-bottom: 1rem;
	}
	.subscription .small {
		margin: 0;
	}
	.subscription .founder {
		margin-bottom: 0.5rem;
	}
</style>
