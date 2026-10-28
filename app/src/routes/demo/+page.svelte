<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { page } from '$app/state';
	import Icon from '#lib/components/Icon.svelte';

	// The one page of the demo meant for search engines and link previews.
	const title = 'Demo ausprobieren | mietkartei';
	const description =
		'Teste mietkartei, die Open-Source-Hausverwaltung für Privatvermieter, mit eigenem ' +
		'Beispielbestand: Mietkonto, Bankumsätze und Betriebskostenabrechnung. Ohne Anmeldung.';
	const url = $derived(`${page.url.origin}/demo`);

	// What the server does while the visitor waits, in its order. It reports no progress of its
	// own, so the steps advance on a timer and the last one stays open until the demo is there.
	const steps = [
		'Häuser und Wohnungen anlegen',
		'Mietverträge und Mietzahlungen buchen',
		'Bankumsätze einlesen',
		'Betriebskostenabrechnungen erstellen',
		'Briefe und Belege ablegen'
	];
	const STEP_MS = 650;

	let starting = $state(false);
	let step = $state(0);

	$effect(() => {
		if (!starting) return;
		step = 0;
		const timer = setInterval(() => {
			if (step < steps.length - 1) step += 1;
		}, STEP_MS);
		return () => clearInterval(timer);
	});

	// The indicator stays until the demo's start page has loaded; only a failure takes it back.
	const start: SubmitFunction = () => {
		starting = true;
		return async ({ result, update }) => {
			if (result.type !== 'redirect') starting = false;
			await update();
		};
	};
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={url} />
	<meta property="og:type" content="website" />
	<meta property="og:url" content={url} />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
</svelte:head>

<div class="narrow">
	<h1>mietkartei ausprobieren</h1>
	<p class="auth-lead">
		Du bekommst einen eigenen Beispielbestand: zwei Häuser, fünf Mietverträge, zwei Jahre
		Mietzahlungen, offene Bankumsätze und die Belege für eine Betriebskostenabrechnung. Ändere,
		lösche und rechne nach Belieben; nach 24 Stunden wird alles gelöscht.
	</p>
	<form method="POST" class="card" use:enhance={start} aria-busy={starting}>
		{#if starting}
			<div class="starting" role="status">
				<div class="track" aria-hidden="true"><div class="bar"></div></div>
				<p class="sr-only">Deine Demo wird angelegt: {steps[step]}.</p>
				<ol aria-hidden="true">
					{#each steps as label, index (label)}
						<li class:done={index < step} class:current={index === step}>
							<span class="mark">
								{#if index < step}<Icon name="check" size={12} />{/if}
							</span>
							{label}
						</li>
					{/each}
				</ol>
			</div>
		{:else}
			<p>Ohne Anmeldung, ohne E-Mail-Adresse. Gib in der Demo bitte keine echten Daten ein.</p>
		{/if}
		<div class="form-actions">
			<button type="submit" disabled={starting}>
				{#if starting}<span class="spinner" aria-hidden="true"></span>Demo wird angelegt …{:else}Demo
					starten{/if}
			</button>
		</div>
	</form>
	<p class="questions small"><a href="https://mietkartei.de/fragen/">Fragen?</a></p>
</div>

<style>
	.questions {
		margin: 0;
		text-align: center;
	}
	.starting {
		display: grid;
		gap: 1.25rem;
	}
	/* A thin rail that fills with the neon of the logo, fast at first and ever slower, so it never
	   claims to be done before the demo is. */
	.track {
		position: relative;
		height: 4px;
		overflow: hidden;
		border-radius: 999px;
		background: var(--color-border);
	}
	.bar {
		position: absolute;
		inset: 0 auto 0 0;
		width: 94%;
		border-radius: inherit;
		background: var(--color-highlight);
		box-shadow: 0 0 12px color-mix(in srgb, var(--color-highlight) 70%, transparent);
		transform-origin: left;
		animation: fill 6s cubic-bezier(0.1, 0.7, 0.2, 1) both;
	}
	.bar::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(90deg, transparent, rgb(255 255 255 / 70%), transparent);
		translate: -100% 0;
		animation: sheen 1.6s ease-in-out infinite;
	}
	ol {
		display: grid;
		gap: 0.6rem;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: var(--text-sm);
	}
	li {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		color: var(--color-muted);
		opacity: 0.55;
		transition:
			opacity 240ms,
			color 240ms;
	}
	li.done,
	li.current {
		opacity: 1;
	}
	li.current {
		color: var(--color-text);
		font-weight: 500;
	}
	.mark {
		display: inline-grid;
		flex: none;
		place-items: center;
		width: 18px;
		height: 18px;
		border: 1px solid var(--color-border);
		border-radius: 50%;
		transition:
			background 240ms,
			border-color 240ms;
	}
	li.done .mark {
		border-color: transparent;
		background: var(--color-highlight);
		color: var(--color-highlight-text);
	}
	li.current .mark {
		border-color: transparent;
		background: color-mix(in srgb, var(--color-highlight) 22%, transparent);
	}
	li.current .mark::after {
		content: '';
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--color-highlight);
		box-shadow: 0 0 8px var(--color-highlight);
		/* On white the neon alone is hard to see; a dark ring keeps the dot readable. */
		outline: 1px solid light-dark(rgb(0 0 0 / 35%), transparent);
		animation: pulse 1.1s ease-in-out infinite;
	}
	button:disabled {
		cursor: progress;
		opacity: 1;
	}
	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
		border-top-color: var(--color-highlight);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes fill {
		from {
			transform: scaleX(0.04);
		}
		to {
			transform: scaleX(1);
		}
	}
	@keyframes sheen {
		to {
			translate: 100% 0;
		}
	}
	@keyframes pulse {
		50% {
			scale: 0.6;
			opacity: 0.6;
		}
	}
	@keyframes spin {
		to {
			rotate: 360deg;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.bar,
		.bar::after,
		li.current .mark::after,
		.spinner {
			animation: none;
		}
		.bar {
			transform: scaleX(0.6);
		}
	}
</style>
