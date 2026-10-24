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
</script>

<PageHeader title="Mitverwalter" />

{#if refused}
	<Alert tone="danger"><p>{refused}</p></Alert>
{:else if form && 'invited' in form}
	<Alert tone="success"><p>Die Einladung an {form.invited} ist unterwegs.</p></Alert>
{:else if form && 'revoked' in form}
	<Alert tone="success"><p>Die Einladung wurde zurückgezogen.</p></Alert>
{:else if form && 'removed' in form}
	<Alert tone="success"><p>Der Zugang wurde entfernt.</p></Alert>
{/if}

<h2>Zugänge</h2>
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
					<td>{userRoleLabels[user.role]}</td>
					<td class="actions">
						{#if user.id !== data.userId}
							<ConfirmButton
								action="?/remove"
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
					<th>Status</th>
					<th class="actions"></th>
				</tr>
			</thead>
			<tbody>
				{#each data.invitations as invitation (invitation.id)}
					<tr>
						<td>{invitation.email}</td>
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
	Die eingeladene Person bekommt eine E-Mail mit einem Link, der sieben Tage gilt, und arbeitet als
	Mitverwalter mit: Mitverwalter bearbeiten alles außer Einladungen und Bankverbindungen. Ein Konto
	hat höchstens {data.maxMembers} Zugänge, offene Einladungen eingerechnet.
</p>
{#if data.freeSeats === 0}
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
		<div class="form-actions">
			<button type="submit">Einladen</button>
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
</style>
