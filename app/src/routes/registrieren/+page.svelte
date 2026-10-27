<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { LAUNCH } from '#lib/launch.ts';
	import { MIN_PASSWORD_LENGTH } from '#lib/validation.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Registrieren | mietkartei</title>
	{#if data.turnstileSiteKey}
		<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
	{/if}
</svelte:head>

<div class="narrow">
	<h1>Registrieren</h1>
	{#if data.open && !form?.closed}<p class="auth-lead">
			Dein Konto für eine übersichtliche Hausverwaltung.
		</p>{/if}

	{#if !data.open || form?.closed}
		<p>Auf dieser Instanz können sich keine weiteren Personen registrieren.</p>
	{:else if form?.sent}
		<p role="status">
			Wir haben dir eine E-Mail mit einem Link geschickt. Öffne ihn innerhalb eines Tages, um dein
			Konto anzulegen. Hast du schon ein Konto, kommt keine E-Mail: Melde dich dann an oder setze
			dein Passwort zurück.
		</p>
	{:else}
		{#if data.restricted}
			<p>
				{#if data.prelaunch}mietkartei startet im {LAUNCH}. Bis dahin{:else}Hier{/if} können nur freigeschaltete
				E-Mail-Adressen ein Konto anlegen. Du bekommst einen Link, mit dem du die Adresse bestätigst und
				dein Passwort wählst.
			</p>
		{/if}
		<form
			method="POST"
			class="card"
			use:enhance={() =>
				async ({ update }) => {
					await update();
					// A token is valid for one check only, so a refused attempt needs a new one.
					window.turnstile?.reset();
				}}
		>
			<label>
				E-Mail-Adresse
				<input
					name="email"
					type="email"
					defaultValue={form?.values?.email ?? ''}
					autocomplete="username"
					aria-invalid={form?.errors?.email ? 'true' : undefined}
					required
				/>
				{#if form?.errors?.email}<span class="error">{form.errors.email}</span>{/if}
			</label>
			{#if !data.restricted}
				<label>
					Passwort
					<input
						name="password"
						type="password"
						autocomplete="new-password"
						minlength={MIN_PASSWORD_LENGTH}
						aria-invalid={form?.errors?.password ? 'true' : undefined}
						required
					/>
					<span class="muted">Mindestens {MIN_PASSWORD_LENGTH} Zeichen.</span>
					{#if form?.errors?.password}<span class="error">{form.errors.password}</span>{/if}
				</label>
			{/if}
			{#if data.setupCode}
				<label>
					Einrichtungscode
					<input
						name="setupCode"
						type="password"
						autocomplete="off"
						aria-invalid={form?.wrongSetupCode ? 'true' : undefined}
						required
					/>
					<span class="muted"
						>Den Code hast du beim Einrichten von mietkartei selbst festgelegt.</span
					>
					{#if form?.wrongSetupCode}<span class="error">Der Einrichtungscode stimmt nicht.</span
						>{/if}
				</label>
			{/if}
			{#if data.turnstileSiteKey}
				<div class="cf-turnstile" data-sitekey={data.turnstileSiteKey} data-language="de"></div>
			{/if}
			{#if form?.notListed}
				<p class="error" role="alert">
					Diese E-Mail-Adresse ist nicht für eine Registrierung freigeschaltet.
				</p>
			{/if}
			{#if form?.unavailable}
				<p class="error" role="alert">{form.unavailable}</p>
			{/if}
			{#if form?.botCheckFailed}
				<p class="error" role="alert">
					Die Prüfung, ob hier ein Mensch registriert, hat nicht geklappt. Bitte versuche es noch
					einmal.
				</p>
			{/if}
			{#if data.hosted}
				<p class="muted">
					Wie mietkartei deine Daten und die deiner Mieter verarbeitet, steht in der
					<a href="https://mietkartei.de/datenschutz/">Datenschutzerklärung</a>. Mit dem Konto gilt
					der
					<a href="https://mietkartei.de/auftragsverarbeitung/">Vertrag zur Auftragsverarbeitung</a> für
					die Daten deiner Mieter.
				</p>
			{/if}
			<div class="form-actions">
				<button type="submit">{data.restricted ? 'Link anfordern' : 'Konto anlegen'}</button>
			</div>
		</form>
	{/if}

	<p class="muted">Schon registriert? <a href={resolve('/anmelden')}>Anmelden</a></p>
</div>
