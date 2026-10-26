<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { formatDateTime } from '#lib/dates.ts';
	import { userRoleLabels } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	const values = $derived(form && 'values' in form ? form.values : undefined);
	const refused = $derived(form && 'refused' in form ? form.refused : undefined);
	/** memberRoles of the schema, which a page may not import. */
	const memberRoles = ['manager', 'viewer'] as const;
</script>

<PageHeader title="Zugänge" />

{#if refused}
	<Alert tone="danger"><p>{refused}</p></Alert>
{:else if form && 'invited' in form}
	<Alert tone="success"><p>Die Einladung an {form.invited} ist unterwegs.</p></Alert>
{:else if form && 'revoked' in form}
	<Alert tone="success"><p>Die Einladung wurde zurückgezogen.</p></Alert>
{:else if form && 'roleChanged' in form}
	<Alert tone="success"><p>Die Rolle wurde geändert.</p></Alert>
{:else if form && 'removed' in form}
	<Alert tone="success"><p>Der Zugang wurde entfernt.</p></Alert>
{/if}

<h2>Personen</h2>
<div class="table-wrap">
	<table class="table" aria-label="Zugänge">
		<thead>
			<tr>
				<th>Name</th>
				<th>E-Mail-Adresse</th>
				<th>Rolle</th>
				<th class="actions"></th>
			</tr>
		</thead>
		<tbody>
			{#each data.users as user (user.id)}
				<tr>
					<td>
						{user.name ?? '–'}
						{#if user.id === data.userId}<span class="muted">(du)</span>{/if}
					</td>
					<td>{user.email}</td>
					<td>
						{#if user.role === 'owner' || user.id === data.userId}
							{userRoleLabels[user.role]}
						{:else}
							<form method="POST" action="?/role" class="inline role" use:enhance>
								<input type="hidden" name="userId" value={user.id} />
								<select name="role" aria-label="Rolle von {user.name ?? user.email}">
									{#each memberRoles as role (role)}
										<option value={role} selected={role === user.role}
											>{userRoleLabels[role]}</option
										>
									{/each}
								</select>
								<button type="submit" class="secondary small">Ändern</button>
							</form>
						{/if}
					</td>
					<td class="actions">
						{#if user.id !== data.userId}
							<ConfirmButton
								action="?/remove"
								small
								label="Entfernen"
								message="Zugang von {user.name ??
									user.email} entfernen? Die Person kann sich dann nicht mehr anmelden."
							>
								<input type="hidden" name="userId" value={user.id} />
							</ConfirmButton>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<h2>Einladungen</h2>
{#if data.invitations.length === 0}
	<p class="muted">Keine Einladungen.</p>
{:else}
	<div class="table-wrap">
		<table class="table" aria-label="Einladungen">
			<thead>
				<tr>
					<th>E-Mail-Adresse</th>
					<th>Rolle</th>
					<th>Status</th>
					<th class="actions"></th>
				</tr>
			</thead>
			<tbody>
				{#each data.invitations as invitation (invitation.id)}
					<tr>
						<td>{invitation.email}</td>
						<td>{userRoleLabels[invitation.role]}</td>
						<td>
							{invitation.expired ? 'Abgelaufen am' : 'Gültig bis'}
							{formatDateTime(invitation.expiresAt)}
						</td>
						<td class="actions">
							<form method="POST" action="?/resend" class="inline" use:enhance>
								<input type="hidden" name="invitationId" value={invitation.id} />
								<button type="submit" class="secondary small">Erneut senden</button>
							</form>
							<form method="POST" action="?/revoke" class="inline" use:enhance>
								<input type="hidden" name="invitationId" value={invitation.id} />
								<button type="submit" class="secondary small">Zurückziehen</button>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<h2>Einladen</h2>
<p class="muted">
	Die eingeladene Person bekommt eine E-Mail mit einem Link, der sieben Tage gilt. Mitverwalter
	bearbeiten alles außer Zugängen, Bankverbindungen, Abo und Export; mit Lesezugriff sieht die
	Person alles, ändert aber nichts. Ein Konto hat höchstens {data.maxMembers} Zugänge, offene Einladungen
	eingerechnet.
</p>
{#if data.freeSeats <= 0}
	<p>Alle Plätze sind belegt. Entferne einen Zugang oder ziehe eine Einladung zurück.</p>
{:else}
	<form method="POST" action="?/invite" class="card" use:enhance>
		<label>
			E-Mail-Adresse
			<input
				name="email"
				type="email"
				defaultValue={values?.email ?? ''}
				aria-invalid={errors?.email ? 'true' : undefined}
				required
			/>
			{#if errors?.email}<span class="error">{errors.email}</span>{/if}
		</label>
		<label>
			Rolle
			<select name="role">
				{#each memberRoles as role (role)}
					<option value={role} selected={role === (values?.role ?? 'manager')}
						>{userRoleLabels[role]}</option
					>
				{/each}
			</select>
		</label>
		<div class="form-actions">
			<button type="submit">Einladen</button>
		</div>
	</form>
{/if}

{#if data.users.some((user) => user.id !== data.userId)}
	<h2>Konto übergeben</h2>
	<p class="muted">
		Die gewählte Person wird Vermieter des Kontos und verwaltet dann Zugänge, Bankverbindungen und
		Abo; du arbeitest als Mitverwalter weiter. Das Abo bleibt, wie es ist.
	</p>
	<form method="POST" action="?/transfer" class="card" use:enhance>
		<label>
			Neuer Vermieter
			<select name="userId" required>
				{#each data.users.filter((user) => user.id !== data.userId) as user (user.id)}
					<option value={user.id}>{user.name ?? user.email}</option>
				{/each}
			</select>
		</label>
		<label>
			Dein Passwort
			<input
				name="password"
				type="password"
				autocomplete="current-password"
				maxlength="200"
				required
			/>
		</label>
		<div class="form-actions">
			<button type="submit" class="danger">Konto übergeben</button>
		</div>
	</form>
{/if}

<style>
	.inline {
		display: inline;
	}
	.inline + .inline {
		margin-left: 0.5rem;
	}
	.role {
		display: inline-flex;
		gap: 0.5rem;
		align-items: center;
	}
</style>
