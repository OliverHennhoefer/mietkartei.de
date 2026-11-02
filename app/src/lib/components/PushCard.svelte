<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount, tick } from 'svelte';

	// The Mitteilungen of this browser: asks for the permission, subscribes at the browser's push
	// service with the server's key and hands the subscription to the form action ?/push, which
	// stores it and sends a test. iPhones and iPads only allow it once the app is on the home
	// screen, so there the card explains that one step instead.

	let {
		publicKey,
		endpoints
	}: {
		/** The server's VAPID key; null in the demo, which sends nothing. */
		publicKey: string | null;
		/** The push addresses of the user's channels, to tell whether this browser is one. */
		endpoints: string[];
	} = $props();

	type State = 'checking' | 'unsupported' | 'install' | 'denied' | 'ready' | 'connected';
	let status = $state<State>('checking');
	let busy = $state(false);
	let problem = $state('');
	let form = $state<HTMLFormElement>();
	let endpoint = $state('');
	let p256dh = $state('');
	let auth = $state('');
	let current = $state<string | null>(null);

	const connected = $derived(current !== null && endpoints.includes(current));

	function isAppleMobile(): boolean {
		return (
			/iPhone|iPad|iPod/.test(navigator.userAgent) ||
			// iPads ask for the desktop site and call themselves Macintosh.
			(navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)
		);
	}

	function standalone(): boolean {
		return (
			matchMedia('(display-mode: standalone)').matches ||
			(navigator as Navigator & { standalone?: boolean }).standalone === true
		);
	}

	onMount(async () => {
		// Safari on iPhones and iPads offers Mitteilungen only to apps on the home screen.
		if (isAppleMobile() && !standalone()) {
			status = 'install';
			return;
		}
		const supported =
			'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
		if (!supported) {
			status = 'unsupported';
			return;
		}
		if (Notification.permission === 'denied') {
			status = 'denied';
			return;
		}
		const registration = await navigator.serviceWorker.getRegistration();
		const subscription = await registration?.pushManager.getSubscription();
		current = subscription?.endpoint ?? null;
		status = 'ready';
	});

	function keyBytes(key: string): Uint8Array<ArrayBuffer> {
		const base64 = key.replaceAll('-', '+').replaceAll('_', '/');
		const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
		return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
	}

	function encode(buffer: ArrayBuffer | null): string {
		if (!buffer) return '';
		return btoa(String.fromCharCode(...new Uint8Array(buffer)))
			.replaceAll('+', '-')
			.replaceAll('/', '_')
			.replace(/=+$/, '');
	}

	/** The promise, or an error once `seconds` have passed without an answer. */
	function within<T>(promise: Promise<T>, seconds: number): Promise<T> {
		const timeout = new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error('timeout')), seconds * 1000)
		);
		return Promise.race([promise, timeout]);
	}

	async function enable() {
		problem = '';
		if (!form) return;
		// The demo stores nothing; its action says so.
		if (!publicKey) {
			form.requestSubmit();
			return;
		}
		busy = true;
		try {
			const permission = await Notification.requestPermission();
			if (permission !== 'granted') {
				status = permission === 'denied' ? 'denied' : 'ready';
				if (permission !== 'denied') problem = 'Ohne deine Erlaubnis kommen keine Mitteilungen.';
				return;
			}
			// The app's service worker, which starts with the app.
			const worker = await within(navigator.serviceWorker.ready, 10);
			let subscription = await worker.pushManager.getSubscription();
			// A subscription made with another key (an earlier server key) cannot be used.
			if (subscription) {
				const key = encode(subscription.options.applicationServerKey);
				if (key && key !== publicKey) {
					await subscription.unsubscribe();
					subscription = null;
				}
			}
			// The browser asks its push service, which may not answer when the device is offline.
			subscription ??= await within(
				worker.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: keyBytes(publicKey)
				}),
				30
			);
			endpoint = subscription.endpoint;
			p256dh = encode(subscription.getKey('p256dh'));
			auth = encode(subscription.getKey('auth'));
			current = endpoint;
			// The hidden fields take the new values before the form is sent.
			await tick();
			form.requestSubmit();
		} catch {
			problem =
				'Der Browser hat die Mitteilungen nicht eingerichtet. Lade die Seite neu und versuche es noch einmal.';
		} finally {
			busy = false;
		}
	}
</script>

<form method="POST" action="?/push" class="card" use:enhance bind:this={form}>
	<h3>Mitteilungen auf diesem Gerät</h3>
	<p class="muted">
		Hinweise erscheinen als Mitteilung auf diesem Handy oder Computer, ohne weitere App und ohne
		Konto. Richte sie auf jedem Gerät ein, auf dem du sie haben willst. Ohne „mit Namen“ gehen nur
		Art, Datum und Link mit.
	</p>
	<input type="hidden" name="endpoint" value={endpoint} />
	<input type="hidden" name="p256dh" value={p256dh} />
	<input type="hidden" name="auth" value={auth} />

	{#if status === 'install'}
		<div class="steps">
			<p><strong>Auf dem iPhone und iPad in drei Schritten:</strong></p>
			<ol>
				<li>Tippe in Safari unten auf <strong>Teilen</strong> (das Quadrat mit dem Pfeil).</li>
				<li>
					Wähle <strong>Zum Home-Bildschirm</strong> und tippe auf <strong>Hinzufügen</strong>.
				</li>
				<li>
					Öffne mietkartei über das neue Symbol, melde dich an und schalte hier die Mitteilungen
					ein.
				</li>
			</ol>
		</div>
	{:else if status === 'unsupported'}
		<p class="muted">
			Dieser Browser kann keine Mitteilungen anzeigen. Nimm einen aktuellen Browser oder die
			Hinweise per E-Mail.
		</p>
	{:else if status === 'denied'}
		<p class="error">
			Mitteilungen sind für mietkartei in diesem Browser blockiert. Erlaube sie in den Einstellungen
			des Browsers für diese Seite und lade die Seite danach neu.
		</p>
	{:else if connected}
		<p><strong>Dieses Gerät ist verbunden.</strong> Mit „Test senden“ in der Liste prüfst du es.</p>
	{:else}
		<label class="inline">
			<input type="checkbox" name="urgentOnly" />
			Nur Dringendes
		</label>
		<label class="inline">
			<input type="checkbox" name="details" />
			Mit Namen der Mieter
		</label>
		{#if problem}
			<p class="error">{problem}</p>
		{/if}
		<div class="form-actions">
			<button type="button" onclick={enable} disabled={busy || status === 'checking'}>
				{busy ? 'Einen Moment …' : 'Mitteilungen einschalten'}
			</button>
		</div>
	{/if}
</form>

<style>
	form.card {
		grid-template-columns: 1fr;
		gap: 1rem;
	}
	h3,
	p {
		margin: 0;
	}
	ol {
		margin: 0.5rem 0 0;
		padding-left: 1.25rem;
		display: grid;
		gap: 0.35rem;
	}
</style>
