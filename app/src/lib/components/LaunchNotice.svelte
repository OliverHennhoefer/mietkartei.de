<script lang="ts">
	import { LAUNCH } from '#lib/launch.ts';

	// Until the public launch, a notice over the sign-in page names the launch date. The server
	// renders it open and its button closes it without JavaScript too; once mounted it becomes
	// modal. Delete this component with launch.ts once mietkartei has launched.
	let dialog = $state<HTMLDialogElement>();

	$effect(() => {
		if (!dialog?.open || dialog.matches(':modal')) return;
		dialog.close();
		dialog.showModal();
	});
</script>

<dialog bind:this={dialog} class="launch-notice" aria-labelledby="launch-notice-text" open>
	<p id="launch-notice-text">
		mietkartei startet im {LAUNCH}. Bis dahin melden sich hier nur freigeschaltete Vermieter an.
	</p>
	<form method="dialog">
		<button type="submit">Verstanden</button>
	</form>
</dialog>
