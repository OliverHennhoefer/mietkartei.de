<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { MIN_PASSWORD_LENGTH } from '#lib/validation.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// Each form reads only the answer addressed to it; `form.form` names the one that answered.
	const profile = $derived(form?.form === 'profile' ? form : undefined);
	const profileErrors = $derived(profile && 'errors' in profile ? profile.errors : undefined);
	const profileValues = $derived(profile && 'values' in profile ? profile.values : undefined);
	const password = $derived(form?.form === 'password' ? form : undefined);
	const passwordErrors = $derived(password && 'errors' in password ? password.errors : undefined);
	const landlord = $derived(form?.form === 'landlord' ? form : undefined);
	const landlordErrors = $derived(landlord && 'errors' in landlord ? landlord.errors : undefined);
	const landlordValues = $derived(
		landlord?.values ?? {
			landlordName: data.landlord.landlordName ?? '',
			street: data.landlord.street ?? '',
			postalCode: data.landlord.postalCode ?? '',
			city: data.landlord.city ?? '',
			iban: data.landlord.iban ?? '',
			bankName: data.landlord.bankName ?? ''
		}
	);
</script>

<PageHeader title="Profil" />

<div class="stack">
	<section>
		<h2>Name und E-Mail-Adresse</h2>
		{#if profile && 'saved' in profile}
			<Alert tone="success">
				<p>Dein Profil wurde gespeichert.</p>
				{#if profile.pendingEmail}
					<p>
						Wir haben dir einen Link an {profile.pendingEmail} geschickt. Erst wenn du ihn öffnest, gilt
						die neue E-Mail-Adresse; bis dahin meldest du dich mit der bisherigen an.
					</p>
				{/if}
			</Alert>
		{/if}
		<form method="POST" action="?/profile" class="card" use:enhance>
			<label>
				Name
				<input
					name="name"
					defaultValue={profileValues?.name ?? data.user.name ?? ''}
					autocomplete="name"
					aria-invalid={profileErrors?.name ? 'true' : undefined}
				/>
				{#if profileErrors?.name}<span class="error">{profileErrors.name}</span>{/if}
			</label>
			<label>
				E-Mail-Adresse
				<input
					name="email"
					type="email"
					defaultValue={profileValues?.email ?? data.user.email}
					autocomplete="username"
					aria-invalid={profileErrors?.email ? 'true' : undefined}
					required
				/>
				{#if profileErrors?.email}<span class="error">{profileErrors.email}</span>{/if}
			</label>
			<label>
				Aktuelles Passwort (nur zum Ändern der E-Mail-Adresse)
				<input
					name="currentPassword"
					type="password"
					autocomplete="current-password"
					aria-invalid={profileErrors?.currentPassword ? 'true' : undefined}
				/>
				{#if profileErrors?.currentPassword}
					<span class="error">{profileErrors.currentPassword}</span>
				{/if}
			</label>
			<div class="form-actions">
				<button type="submit">Profil speichern</button>
			</div>
		</form>
	</section>

	<section>
		<h2>Passwort ändern</h2>
		{#if password && 'saved' in password}
			<Alert tone="success">
				<p>Dein Passwort wurde geändert. Auf anderen Geräten bist du jetzt abgemeldet.</p>
			</Alert>
		{/if}
		<form method="POST" action="?/password" class="card" use:enhance>
			<label>
				Aktuelles Passwort
				<input
					name="currentPassword"
					type="password"
					autocomplete="current-password"
					aria-invalid={passwordErrors?.currentPassword ? 'true' : undefined}
					required
				/>
				{#if passwordErrors?.currentPassword}
					<span class="error">{passwordErrors.currentPassword}</span>
				{/if}
			</label>
			<label>
				Neues Passwort
				<input
					name="password"
					type="password"
					autocomplete="new-password"
					minlength={MIN_PASSWORD_LENGTH}
					aria-invalid={passwordErrors?.password ? 'true' : undefined}
					required
				/>
				<span class="muted">Mindestens {MIN_PASSWORD_LENGTH} Zeichen.</span>
				{#if passwordErrors?.password}<span class="error">{passwordErrors.password}</span>{/if}
			</label>
			<label>
				Neues Passwort wiederholen
				<input
					name="passwordConfirm"
					type="password"
					autocomplete="new-password"
					aria-invalid={passwordErrors?.passwordConfirm ? 'true' : undefined}
					required
				/>
				{#if passwordErrors?.passwordConfirm}
					<span class="error">{passwordErrors.passwordConfirm}</span>
				{/if}
			</label>
			<div class="form-actions">
				<button type="submit">Passwort ändern</button>
			</div>
		</form>
	</section>

	<section>
		<h2>Vermieter (Absender)</h2>
		<p class="muted">
			Briefe und Betriebskostenabrechnungen drucken diese Angaben als Absender; die IBAN steht auf
			der Abrechnung für Nachzahlungen. Solange der Block leer ist, steht der Name deines Kontos
			dort.
		</p>
		{#if landlord && 'saved' in landlord}
			<Alert tone="success"><p>Der Absender wurde gespeichert.</p></Alert>
		{/if}
		<form method="POST" action="?/landlord" class="card" use:enhance>
			<label>
				Name des Vermieters
				<input
					name="landlordName"
					defaultValue={landlordValues.landlordName ?? ''}
					aria-invalid={landlordErrors?.landlordName ? 'true' : undefined}
				/>
				{#if landlordErrors?.landlordName}
					<span class="error">{landlordErrors.landlordName}</span>
				{/if}
			</label>
			<label>
				Straße und Hausnummer
				<input
					name="street"
					defaultValue={landlordValues.street ?? ''}
					aria-invalid={landlordErrors?.street ? 'true' : undefined}
				/>
				{#if landlordErrors?.street}<span class="error">{landlordErrors.street}</span>{/if}
			</label>
			<label>
				Postleitzahl
				<input
					name="postalCode"
					defaultValue={landlordValues.postalCode ?? ''}
					inputmode="numeric"
					aria-invalid={landlordErrors?.postalCode ? 'true' : undefined}
				/>
				{#if landlordErrors?.postalCode}
					<span class="error">{landlordErrors.postalCode}</span>
				{/if}
			</label>
			<label>
				Ort
				<input
					name="city"
					defaultValue={landlordValues.city ?? ''}
					aria-invalid={landlordErrors?.city ? 'true' : undefined}
				/>
				{#if landlordErrors?.city}<span class="error">{landlordErrors.city}</span>{/if}
			</label>
			<label>
				IBAN
				<input
					name="iban"
					autocapitalize="characters"
					spellcheck="false"
					defaultValue={landlordValues.iban ?? ''}
					aria-invalid={landlordErrors?.iban ? 'true' : undefined}
				/>
				{#if landlordErrors?.iban}<span class="error">{landlordErrors.iban}</span>{/if}
			</label>
			<label>
				Bank
				<input
					name="bankName"
					defaultValue={landlordValues.bankName ?? ''}
					aria-invalid={landlordErrors?.bankName ? 'true' : undefined}
				/>
				{#if landlordErrors?.bankName}<span class="error">{landlordErrors.bankName}</span>{/if}
			</label>
			<div class="form-actions">
				<button type="submit">Absender speichern</button>
			</div>
		</form>
	</section>
</div>
