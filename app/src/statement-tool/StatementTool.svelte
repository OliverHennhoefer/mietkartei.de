<script lang="ts">
	import { formatDate, today as berlinToday } from '../lib/dates';
	import { fuelLabels } from '../lib/labels';
	import { formatCents } from '../lib/money';
	import { balanceLabel, periodLabel, type LeaseStatement } from '../lib/domain/statement';
	import {
		categoryName,
		computeTool,
		directRows,
		applyLetterEdits,
		filledItems,
		isHeating,
		itemsTotal,
		meterUnit,
		newItem,
		newTenancy,
		newToolState,
		newUnit,
		nextPeriod,
		parseToolFile,
		toolFile,
		toolFuels,
		toolKeyKinds,
		toolKeyLabels,
		toolMeterKinds,
		toolMeterLabels,
		usedMeters,
		type ToolItem,
		type ToolLetterEdit,
		type ToolState,
		type ToolUnit
	} from '../lib/domain/statement-tool';
	import {
		clearDraft,
		forgetDraft,
		clearRescuedDraft,
		fileSavedOn,
		loadDraft,
		markFileSaved,
		rescuedDraft,
		saveDraft
	} from './draft';
	import { exampleToolState } from './example';
	import LetterEditor from './LetterEditor.svelte';
	import { statementFilename, statementLetter } from '../lib/domain/statement-letter';
	import type { Letter } from '../lib/domain/letters';

	// The whole tool on one page: house and landlord, flats and tenants, the costs with their keys,
	// the consumption where a key needs it, and the result with a PDF per tenant. The result is
	// computed on every change with the app's own computation; nothing is sent anywhere.

	const today = berlinToday();
	const draft = loadDraft(today);
	let form = $state<ToolState>(draft.state ?? newToolState(today));
	// The entries without their random ids, to tell an untouched form from one with entries.
	const withoutIds = (state: ToolState) =>
		JSON.stringify(state, (key, value) => (key === 'id' ? undefined : value));
	const emptyForm = withoutIds(newToolState(today));
	const result = $derived(computeTool(form, today));
	const meters = $derived(usedMeters(form));
	const total = $derived(itemsTotal(form));
	const blocking = $derived(result.issues.filter((issue) => issue.blocking));
	const warnings = $derived(result.statement?.warnings ?? []);
	const hasEntries = $derived(withoutIds(form) !== emptyForm);
	// A stored draft nobody typed into (an earlier version saved the untouched form) is no draft.
	const restored = draft.state !== undefined && withoutIds(draft.state) !== emptyForm;
	let stored = $state(true);
	let notice = $state(restored ? 'Deine letzten Eingaben aus diesem Browser sind wieder da.' : '');
	let rescued = $state(draft.rescued);
	// The example house is loaded; its entries are not the landlord's own.
	let isExample = $state(false);

	// "Mit Beispiel ausprobieren" on the page above the tool links here with ?beispiel; it never
	// replaces entries someone already made.
	const query = location.search.slice(1).split('&').filter(Boolean);
	const rest = query.filter((part) => part.split('=')[0] !== 'beispiel');
	if (rest.length < query.length) {
		if (restored) {
			notice =
				'Deine letzten Eingaben aus diesem Browser sind wieder da. Das Beispiel lädst du nach „Neu beginnen“ ganz unten.';
		} else {
			form = exampleToolState(today);
			isExample = true;
		}
		const search = rest.length ? `?${rest.join('&')}` : '';
		history.replaceState(null, '', `${location.pathname}${search}${location.hash}`);
	}
	let savedOn = $state(fileSavedOn());
	let busy = $state('');
	// The step that replaces or clears entries waits for a second click.
	let confirming = $state<'' | 'open' | 'next' | 'reset'>('');
	let fileInput = $state<HTMLInputElement>();

	// Saved a moment after the last change, so typing does not write on every key.
	$effect(() => {
		const snapshot = $state.snapshot(form) as ToolState;
		// An untouched form and the example house are not stored: a first visit or a look at the
		// example leaves nothing behind, and the next visit starts clean.
		const blank = !hasEntries || isExample;
		const save = () => {
			if (blank) forgetDraft();
			else stored = saveDraft(snapshot);
		};
		const timer = setTimeout(save, 400);
		// Closing the tab right after typing still keeps the last entry.
		const flush = () => {
			clearTimeout(timer);
			save();
		};
		window.addEventListener('pagehide', flush);
		return () => {
			clearTimeout(timer);
			window.removeEventListener('pagehide', flush);
		};
	});

	const keyHints: Record<string, string> = {
		area: 'Nach Wohnfläche. Gilt, wenn der Mietvertrag nichts anderes sagt (§ 556a BGB).',
		persons: 'Nach Personen, tagesgenau bei Ein- und Auszug.',
		units: 'Jede Wohnung trägt den gleichen Anteil.',
		consumption: 'Nach dem Verbrauch, den du weiter unten je Wohnung einträgst.',
		mixed: 'Heizkostenverordnung: ein Teil nach Verbrauch, der Rest nach Wohnfläche.',
		direct:
			'Die Beträge je Wohnung, etwa aus der Heizkostenabrechnung des Messdienstes (ista, Techem, Brunata …).'
	};

	function addUnit() {
		form.units.push(newUnit(form.units.length + 1));
	}

	function removeUnit(unit: ToolUnit) {
		form.units = form.units.filter((entry) => entry.id !== unit.id);
	}

	/** A tenant change: the next tenant, with the prepayments of the one before. */
	function addTenancy(unit: ToolUnit) {
		const previous = unit.tenancies.at(-1);
		unit.tenancies.push({
			...newTenancy(),
			operatingCostPrepayment: previous?.operatingCostPrepayment ?? '',
			heatingCostPrepayment: previous?.heatingCostPrepayment ?? ''
		});
	}

	function removeTenancy(unit: ToolUnit, id: string) {
		unit.tenancies = unit.tenancies.filter((tenancy) => tenancy.id !== id);
	}

	/** A second bill of the same Kostenart, right below the first. */
	function addItem(item: ToolItem) {
		const index = form.items.findIndex((entry) => entry.id === item.id);
		const next = { ...newItem(item.category), key: item.key, meter: item.meter };
		form.items.splice(index + 1, 0, next);
	}

	function removeItem(item: ToolItem) {
		const sameCategory = form.items.filter((entry) => entry.category === item.category);
		if (sameCategory.length > 1) form.items = form.items.filter((entry) => entry.id !== item.id);
		else Object.assign(item, newItem(item.category), { id: item.id });
	}

	function toggleCo2(item: ToolItem, on: boolean) {
		item.co2 = on ? { fuel: 'gas', fuelKwh: '', co2Kg: '', co2Cost: '' } : null;
	}

	function leaseName(lease: LeaseStatement): string {
		return lease.tenants
			.map((tenant) => `${tenant.firstName} ${tenant.lastName}`.trim())
			.join(', ');
	}

	/** The letter as computed, before the landlord's wording. */
	function computedLetter(lease: LeaseStatement): Letter {
		return statementLetter(lease, { prepayments: 'entered' });
	}

	function letterOf(lease: LeaseStatement) {
		return applyLetterEdits(computedLetter(lease), form.letterEdits[lease.leaseId]);
	}

	async function pdf(lease: LeaseStatement, letter: Letter = letterOf(lease).letter) {
		busy = lease.leaseId;
		try {
			const { downloadLetter } = await import('./files');
			await downloadLetter(letter, statementFilename(lease));
		} finally {
			busy = '';
		}
	}

	// The lease whose letter is open for editing.
	let editing = $state<LeaseStatement | null>(null);

	function saveEdits(lease: LeaseStatement, edits: ToolLetterEdit[]) {
		if (edits.length > 0) form.letterEdits[lease.leaseId] = edits;
		else delete form.letterEdits[lease.leaseId];
	}

	async function pdfAll() {
		if (!result.statement) return;
		busy = 'all';
		try {
			const { downloadAll } = await import('./files');
			await downloadAll(
				result.statement.leases.map((lease) => letterOf(lease).letter),
				`Betriebskostenabrechnung ${periodLabel(form.periodStart, form.periodEnd)} alle Mieter.pdf`
			);
		} finally {
			busy = '';
		}
	}

	async function saveFile() {
		const { download } = await import('./files');
		download(
			toolFile($state.snapshot(form) as ToolState),
			`Nebenkostenabrechnung ${periodLabel(form.periodStart, form.periodEnd)}.json`,
			'application/json'
		);
		markFileSaved(today);
		savedOn = today;
		notice =
			'Die Datei liegt in deinen Downloads. Öffne sie hier wieder, um weiterzumachen, oder übernimm sie in ein mietkartei-Konto unter Einstellungen → Datenübernahme.';
	}

	async function saveRescued() {
		const content = rescuedDraft();
		if (!content) {
			rescued = false;
			return;
		}
		const { download } = await import('./files');
		download(content, 'Nebenkostenabrechnung früherer Entwurf.json', 'application/json');
		clearRescuedDraft();
		rescued = false;
		notice = 'Der frühere Entwurf liegt als Datei in deinen Downloads.';
	}

	function loadExample() {
		form = exampleToolState(today);
		isExample = true;
		notice = '';
		document.getElementById('ergebnis')?.scrollIntoView({ block: 'start' });
	}

	function chooseFile() {
		confirming = '';
		fileInput?.click();
	}

	async function openFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		const opened = parseToolFile(await file.text(), today);
		if (!opened) {
			notice = 'Diese Datei ist keine gespeicherte Abrechnung aus diesem Rechner.';
			return;
		}
		form = opened;
		confirming = '';
		notice = `„${file.name}“ ist geöffnet.`;
	}

	function startNextPeriod() {
		form = nextPeriod($state.snapshot(form) as ToolState);
		confirming = '';
		notice = `Der Zeitraum ist jetzt ${formatDate(form.periodStart)} bis ${formatDate(form.periodEnd)}. Haus, Wohnungen und Mieter sind übernommen, trag die neuen Beträge ein.`;
		document.getElementById('kosten')?.scrollIntoView();
	}

	function reset() {
		clearDraft();
		form = newToolState(today);
		savedOn = null;
		isExample = false;
		confirming = '';
		notice = 'Alle Eingaben sind gelöscht.';
	}
</script>

<div class="tool">
	{#if notice}
		<p class="notice" role="status">{notice}</p>
	{/if}
	{#if rescued}
		<div class="keep">
			<p>
				Ein früherer Entwurf aus diesem Browser lässt sich mit dieser Version nicht mehr öffnen. Er
				ist aufbewahrt, lade ihn als Datei, bevor du neu anfängst.
			</p>
			<button class="small" type="button" onclick={saveRescued}>Früheren Entwurf laden</button>
		</div>
	{/if}
	{#if isExample}
		<div class="keep example">
			<p>
				<strong>Das ist ein Beispielhaus</strong> mit drei Wohnungen, Mieterwechsel, Wasserzählern und
				Gasheizung. Ändere ruhig Zahlen und sieh, wie sich das Ergebnis ändert.
			</p>
			<button class="small" type="button" onclick={reset}>Leer anfangen</button>
		</div>
	{/if}
	{#if !stored}
		<div class="keep warn" role="alert">
			<p>
				Dieser Browser speichert nichts (privates Fenster?). Speichere die Abrechnung als Datei,
				bevor du die Seite schließt.
			</p>
			<button class="small" type="button" onclick={saveFile}>Als Datei speichern</button>
		</div>
	{:else if hasEntries && !isExample}
		<div class="keep">
			<p>
				Deine Eingaben bleiben in diesem Browser, auch wenn du die Seite schließt.
				{#if savedOn}
					Zuletzt als Datei gesichert am {formatDate(savedOn)}.
				{:else}
					Willst du später weitermachen, sichere sie zusätzlich als Datei: Manche Browser löschen
					gespeicherte Daten nach einigen Tagen ohne Besuch.
				{/if}
			</p>
			<button class="small" type="button" onclick={saveFile}>Als Datei speichern</button>
		</div>
	{/if}

	<section class="tool-section" aria-labelledby="schritt-haus">
		<h2 id="schritt-haus"><span class="number">1</span>Haus und Zeitraum</h2>
		<div class="fields">
			<label>
				<span>Abrechnungszeitraum von</span>
				<input type="date" bind:value={form.periodStart} required />
			</label>
			<label>
				<span>bis</span>
				<input type="date" bind:value={form.periodEnd} required />
			</label>
		</div>
		<div class="fields">
			<label class="wide">
				<span>Straße und Hausnummer des Hauses</span>
				<input bind:value={form.property.street} autocomplete="off" />
			</label>
			<label>
				<span>PLZ</span>
				<input bind:value={form.property.postalCode} inputmode="numeric" autocomplete="off" />
			</label>
			<label>
				<span>Ort</span>
				<input bind:value={form.property.city} autocomplete="off" />
			</label>
		</div>

		<h3>Du als Vermieter</h3>
		<p class="hint">
			Steht als Absender im Brief. Mit IBAN druckt das PDF einen QR-Code zum Überweisen.
		</p>
		<div class="fields">
			<label class="wide">
				<span>Name</span>
				<input bind:value={form.landlord.name} autocomplete="name" />
			</label>
			<label class="wide">
				<span>Straße und Hausnummer</span>
				<input bind:value={form.landlord.street} autocomplete="street-address" />
			</label>
			<label>
				<span>PLZ</span>
				<input
					bind:value={form.landlord.postalCode}
					inputmode="numeric"
					autocomplete="postal-code"
				/>
			</label>
			<label>
				<span>Ort</span>
				<input bind:value={form.landlord.city} autocomplete="address-level2" />
			</label>
			<label class="wide">
				<span>IBAN für Nachzahlungen (optional)</span>
				<input bind:value={form.landlord.iban} autocomplete="off" spellcheck="false" />
			</label>
		</div>
	</section>

	<section class="tool-section" aria-labelledby="schritt-wohnungen">
		<h2 id="schritt-wohnungen"><span class="number">2</span>Wohnungen und Mieter</h2>
		<p class="hint">
			Ein- und Auszug nur eintragen, wenn sie im Zeitraum liegen. Die Vorauszahlungen sind die
			monatlichen Beträge laut Mietvertrag; der Rechner geht davon aus, dass sie gezahlt wurden.
		</p>
		{#each form.units as unit, index (unit.id)}
			<fieldset class="unit">
				<legend class="visually-hidden">{unit.name}</legend>
				<div class="fields">
					<label class="wide">
						<span>Wohnung</span>
						<input bind:value={unit.name} placeholder="z. B. EG links" />
					</label>
					<label>
						<span>Wohnfläche in m²</span>
						<input bind:value={unit.area} inputmode="decimal" placeholder="z. B. 72,5" />
					</label>
				</div>
				{#each unit.tenancies as tenancy, position (tenancy.id)}
					<div class="tenancy">
						<p class="tenancy-title">
							{unit.tenancies.length > 1 ? `${position + 1}. Mieter` : 'Mieter'}
						</p>
						<div class="fields">
							<label>
								<span>Anrede</span>
								<select bind:value={tenancy.salutation}>
									<option value="">–</option>
									<option value="Frau">Frau</option>
									<option value="Herr">Herr</option>
								</select>
							</label>
							<label>
								<span>Vorname</span>
								<input bind:value={tenancy.firstName} autocomplete="off" />
							</label>
							<label>
								<span>Nachname</span>
								<input bind:value={tenancy.lastName} autocomplete="off" />
							</label>
							<label>
								<span>Personen</span>
								<input bind:value={tenancy.persons} inputmode="numeric" />
							</label>
							<label>
								<span>Einzug (falls im Zeitraum)</span>
								<input
									type="date"
									bind:value={tenancy.start}
									min={form.periodStart}
									max={form.periodEnd}
								/>
							</label>
							<label>
								<span>Auszug (falls im Zeitraum)</span>
								<input
									type="date"
									bind:value={tenancy.end}
									min={form.periodStart}
									max={form.periodEnd}
								/>
							</label>
							<label>
								<span>Vorauszahlung Betriebskosten je Monat</span>
								<input
									bind:value={tenancy.operatingCostPrepayment}
									inputmode="decimal"
									placeholder="0,00 €"
								/>
							</label>
							<label>
								<span>Vorauszahlung Heizkosten je Monat</span>
								<input
									bind:value={tenancy.heatingCostPrepayment}
									inputmode="decimal"
									placeholder="0,00 €"
								/>
							</label>
						</div>
						<button class="link" type="button" onclick={() => removeTenancy(unit, tenancy.id)}>
							{unit.tenancies.length > 1
								? 'Diesen Mieter entfernen'
								: 'Kein Mieter: Wohnung stand leer'}
						</button>
					</div>
				{/each}
				{#if unit.tenancies.length === 0}
					<p class="hint">Die Wohnung stand im ganzen Zeitraum leer. Ihren Anteil trägst du.</p>
				{/if}
				<div class="row-actions">
					<button class="small" type="button" onclick={() => addTenancy(unit)}>
						{unit.tenancies.length === 0 ? 'Mieter eintragen' : 'Mieterwechsel eintragen'}
					</button>
					{#if form.units.length > 1}
						<button class="link" type="button" onclick={() => removeUnit(unit)}>
							Wohnung {index + 1} entfernen
						</button>
					{/if}
				</div>
			</fieldset>
		{/each}
		<button class="small" type="button" onclick={addUnit}>Weitere Wohnung</button>
	</section>

	<section class="tool-section" aria-labelledby="kosten">
		<h2 id="kosten"><span class="number">3</span>Kosten und Umlageschlüssel</h2>
		<p class="hint">
			Die 17 umlagefähigen Kostenarten nach § 2 Betriebskostenverordnung. Trag die Kosten des
			Zeitraums ein, die du laut Mietvertrag umlegen darfst; leere Zeilen bleiben draußen.
			Verwaltung und Reparaturen gehören nicht hinein.
		</p>
		<div class="items">
			{#each form.items as item (item.id)}
				<div class="item" class:filled={item.amount.trim() !== ''}>
					<div class="item-row">
						<label class="item-name" for="betrag-{item.id}">
							{categoryName(item.category)}
							<small>§ 2 Nr. {item.category} BetrKV</small>
						</label>
						<div class="amount-field">
							<input
								id="betrag-{item.id}"
								bind:value={item.amount}
								inputmode="decimal"
								placeholder="0,00"
								aria-describedby="betrag-{item.id}-euro"
							/>
							<span id="betrag-{item.id}-euro">€</span>
						</div>
						<select
							bind:value={item.key}
							aria-label="Umlageschlüssel für {categoryName(item.category)}"
						>
							{#each toolKeyKinds as kind (kind)}
								<option value={kind}>{toolKeyLabels[kind]}</option>
							{/each}
						</select>
					</div>
					{#if item.amount.trim() !== ''}
						<div class="item-details">
							<p class="hint">{keyHints[item.key]}</p>
							<div class="fields">
								<label class="wide">
									<span>Bezeichnung im Brief (optional)</span>
									<input
										bind:value={item.description}
										placeholder={item.category === 17
											? 'Pflicht: welche Kosten, z. B. Wartung Rauchmelder'
											: 'z. B. Name des Versorgers'}
									/>
								</label>
								{#if item.key === 'mixed'}
									<label>
										<span>Verbrauch / Fläche</span>
										<select bind:value={item.consumptionPercent}>
											{#each [50, 60, 70] as percent (percent)}
												<option value={percent}>{percent} % / {100 - percent} %</option>
											{/each}
										</select>
									</label>
								{/if}
								{#if item.key === 'mixed' || item.key === 'consumption'}
									<label>
										<span>Verbrauch laut Zähler</span>
										<select bind:value={item.meter}>
											{#each toolMeterKinds as kind (kind)}
												<option value={kind}>{toolMeterLabels[kind]}</option>
											{/each}
										</select>
									</label>
								{/if}
							</div>
							{#if item.key === 'direct'}
								<div class="fields">
									{#each directRows(form) as row (row.id)}
										<label>
											<span>{row.label}</span>
											<input
												value={item.amounts[row.id] ?? ''}
												oninput={(event) =>
													(item.amounts[row.id] = (event.currentTarget as HTMLInputElement).value)}
												inputmode="decimal"
												placeholder="0,00 €"
											/>
										</label>
									{/each}
								</div>
							{/if}
							{#if isHeating(item)}
								<label class="check">
									<input
										type="checkbox"
										checked={item.co2 !== null}
										onchange={(event) =>
											toggleCo2(item, (event.currentTarget as HTMLInputElement).checked)}
									/>
									Mit Gas, Öl oder Fernwärme beheizt: CO₂-Kosten nach dem Stufenmodell aufteilen
								</label>
								{#if item.co2}
									<div class="fields">
										<label>
											<span>Brennstoff</span>
											<select bind:value={item.co2.fuel}>
												{#each toolFuels as fuel (fuel)}
													<option value={fuel}>{fuelLabels[fuel]}</option>
												{/each}
											</select>
										</label>
										<label>
											<span>Verbrauch in kWh</span>
											<input bind:value={item.co2.fuelKwh} inputmode="decimal" />
										</label>
										<label>
											<span>kg CO₂ laut Rechnung</span>
											<input
												bind:value={item.co2.co2Kg}
												inputmode="decimal"
												placeholder="aus kWh berechnet"
											/>
										</label>
										<label>
											<span>CO₂-Kosten laut Rechnung</span>
											<input
												bind:value={item.co2.co2Cost}
												inputmode="decimal"
												placeholder="0,00 €"
											/>
										</label>
									</div>
								{/if}
							{/if}
							<div class="row-actions">
								<button class="link" type="button" onclick={() => addItem(item)}>
									Weitere Rechnung dieser Kostenart
								</button>
								<button class="link" type="button" onclick={() => removeItem(item)}>
									Zeile leeren
								</button>
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
		<p class="total">
			Summe: <strong>{formatCents(total)}</strong>
			{#if filledItems(form).length > 0}
				aus {filledItems(form).length}
				{filledItems(form).length === 1 ? 'Rechnung' : 'Rechnungen'}
			{/if}
		</p>
	</section>

	{#if meters.length > 0}
		<section class="tool-section" aria-labelledby="verbrauch">
			<h2 id="verbrauch"><span class="number">4</span>Verbrauch je Wohnung</h2>
			<p class="hint">
				Der Verbrauch im Zeitraum: Endstand minus Anfangsstand, oder die Einheiten der
				Heizkostenverteiler. Ein Wert gilt für alle Kosten, die nach diesem Zähler verteilt werden.
			</p>
			{#each meters as kind (kind)}
				<h3>{toolMeterLabels[kind]}</h3>
				{#if kind === 'heat'}
					<label class="inline">
						<span>Gemessen in</span>
						<select bind:value={form.heatUnit}>
							<option value="kWh">kWh (Wärmemengenzähler)</option>
							<option value="Einheiten">Einheiten (Heizkostenverteiler)</option>
						</select>
					</label>
				{/if}
				<div class="fields">
					{#each form.units as unit (unit.id)}
						<label>
							<span>{unit.name} in {meterUnit(form, kind)}</span>
							<input
								value={form.consumption[kind][unit.id] ?? ''}
								oninput={(event) =>
									(form.consumption[kind][unit.id] = (
										event.currentTarget as HTMLInputElement
									).value)}
								inputmode="decimal"
							/>
						</label>
					{/each}
				</div>
			{/each}
		</section>
	{/if}

	<section class="tool-section result" aria-labelledby="ergebnis">
		<h2 id="ergebnis"><span class="number">{meters.length > 0 ? 5 : 4}</span>Ergebnis</h2>

		{#if filledItems(form).length > 0 && (blocking.length > 0 || warnings.length > 0)}
			<ul class="findings">
				{#each blocking as issue (issue.message)}
					<li class="blocking">{issue.message}</li>
				{/each}
				{#each warnings as warning (warning.message)}
					<li class:blocking={warning.blocking}>{warning.message}</li>
				{/each}
			</ul>
		{/if}

		{#if result.statement && filledItems(form).length > 0}
			{@const property = result.statement.property}
			<dl class="summary">
				<div>
					<dt>Kosten</dt>
					<dd>{formatCents(property.costsTotal)}</dd>
				</div>
				<div>
					<dt>Davon trägst du</dt>
					<dd>
						{formatCents(
							property.vacancyShare + property.landlordCo2Share + property.unallocatedTotal
						)}
					</dd>
				</div>
				<div>
					<dt>Nachzahlungen</dt>
					<dd>{formatCents(property.nachzahlungen)}</dd>
				</div>
				<div>
					<dt>Guthaben</dt>
					<dd>{formatCents(property.guthaben)}</dd>
				</div>
			</dl>
			<p class="hint">
				Die Abrechnung muss bis {formatDate(property.deadline)} bei den Mietern sein (§ 556 Abs. 3 BGB).
			</p>

			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Mieter</th>
							<th>Wohnung</th>
							<th class="number-cell">Kosten</th>
							<th class="number-cell">Vorauszahlungen</th>
							<th class="number-cell">Ergebnis</th>
							<th><span class="visually-hidden">PDF</span></th>
						</tr>
					</thead>
					<tbody>
						{#each result.statement.leases as lease (lease.leaseId)}
							{@const letter = letterOf(lease)}
							<tr>
								<td>
									{leaseName(lease)}
									{#if lease.occupancy.days < lease.period.days}
										<small>
											{formatDate(lease.occupancy.start)} bis {formatDate(lease.occupancy.end)}
										</small>
									{/if}
								</td>
								<td>{lease.units.map((unit) => unit.name).join(', ')}</td>
								<td class="number-cell">{formatCents(lease.costsTotal)}</td>
								<td class="number-cell">{formatCents(lease.prepaymentsTotal)}</td>
								<td class="number-cell">
									<strong>{balanceLabel(lease.balance)}</strong>
									{#if lease.balance !== 0}{formatCents(Math.abs(lease.balance))}{/if}
								</td>
								<td>
									<div class="lease-actions">
										<button
											class="small"
											type="button"
											disabled={!result.ready || busy !== ''}
											onclick={() => (editing = lease)}
										>
											Brief ansehen
										</button>
										<button
											class="small"
											type="button"
											disabled={!result.ready || busy !== ''}
											onclick={() => pdf(lease, letter.letter)}
										>
											{busy === lease.leaseId ? 'Wird erstellt …' : 'PDF'}
										</button>
									</div>
									{#if letter.stale.length > 0}
										<small class="edited stale-note">Zahlen geändert, deinen Text prüfen</small>
									{:else if form.letterEdits[lease.leaseId]}
										<small class="edited">Text angepasst</small>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<div class="result-actions">
				<button
					class="primary"
					type="button"
					disabled={!result.ready || busy !== ''}
					onclick={pdfAll}
				>
					{busy === 'all' ? 'Wird erstellt …' : 'Alle Abrechnungen als PDF'}
				</button>
				{#if !result.ready}
					<p class="hint">Sobald oben nichts Rotes mehr steht, kannst du die PDFs laden.</p>
				{:else}
					<p class="hint">
						Jedes PDF ist der fertige Brief an den Mieter: Kostenaufstellung mit Rechenweg,
						Vorauszahlungen, Ergebnis und ein Prüfprotokoll als Anlage. Unter „Brief ansehen“
						änderst du seinen Text, etwa die Anrede oder einen Satz zur Heizung.
					</p>
				{/if}
			</div>
		{:else}
			<p class="hint">
				Sobald du Kosten einträgst, steht hier, was jeder Mieter zahlt oder zurückbekommt.
			</p>
			{#if !hasEntries}
				<button class="small" type="button" onclick={loadExample}>Mit Beispiel ausprobieren</button>
			{/if}
		{/if}
	</section>

	{#if editing}
		{@const lease = editing}
		<LetterEditor
			title="Brief an {leaseName(lease)}"
			letter={computedLetter(lease)}
			edits={form.letterEdits[lease.leaseId] ?? []}
			busy={busy !== ''}
			onsave={(edits) => saveEdits(lease, edits)}
			ondownload={(letter) => pdf(lease, letter)}
			onclose={() => (editing = null)}
		/>
	{/if}

	<section class="tool-section save" aria-labelledby="speichern">
		<h2 id="speichern">Speichern und weitermachen</h2>
		<p class="hint">
			{#if stored}
				Deine Eingaben bleiben nur in diesem Browser gespeichert und werden nicht übertragen. Als
				Datei nimmst du sie auf ein anderes Gerät mit und bist sicher, falls der Browser seine Daten
				löscht.
			{:else}
				Dieser Browser speichert nichts (privates Fenster?). Speichere die Abrechnung als Datei,
				bevor du die Seite schließt.
			{/if}
		</p>
		<div class="result-actions">
			<button class="small" type="button" onclick={saveFile}>Als Datei speichern</button>
			<button
				class="small"
				type="button"
				onclick={() => (hasEntries ? (confirming = 'open') : chooseFile())}
			>
				Datei öffnen
			</button>
			<input
				class="visually-hidden"
				type="file"
				accept=".json,application/json"
				bind:this={fileInput}
				onchange={openFile}
				tabindex="-1"
				aria-hidden="true"
			/>
			<button class="small" type="button" onclick={() => (confirming = 'next')}>
				Für den nächsten Zeitraum übernehmen
			</button>
			<button class="link" type="button" onclick={() => (confirming = 'reset')}>
				Neu beginnen
			</button>
		</div>
		{#if confirming}
			<div class="confirm" role="group" aria-label="Bestätigen">
				<p>
					{#if confirming === 'open'}
						Die Datei ersetzt deine jetzigen Eingaben.
					{:else if confirming === 'next'}
						Die Beträge und Verbräuche dieses Zeitraums werden geleert, Haus, Wohnungen und Mieter
						bleiben.
					{:else}
						Alle Eingaben werden gelöscht.
					{/if}
					{#if savedOn}
						Zuletzt als Datei gesichert am {formatDate(savedOn)}.
					{:else}
						Deine Eingaben sind noch nicht als Datei gesichert.
					{/if}
				</p>
				<div class="result-actions">
					<button class="small" type="button" onclick={saveFile}>Erst als Datei speichern</button>
					{#if confirming === 'open'}
						<button class="small danger" type="button" onclick={chooseFile}>Trotzdem öffnen</button>
					{:else if confirming === 'next'}
						<button class="small danger" type="button" onclick={startNextPeriod}>
							Ja, übernehmen
						</button>
					{:else}
						<button class="small danger" type="button" onclick={reset}>Ja, alles löschen</button>
					{/if}
					<button class="link" type="button" onclick={() => (confirming = '')}>Abbrechen</button>
				</div>
			</div>
		{/if}
	</section>
</div>

<style>
	.tool {
		--field: color-mix(in srgb, var(--code-background), var(--background) 40%);
		--error: #b3261e;
		margin-top: 48px;
		font-size: var(--text-base);
		line-height: 1.5;
	}
	@media (prefers-color-scheme: dark) {
		.tool {
			--error: #f2b8b5;
		}
	}
	.notice {
		margin: 0 0 24px;
		padding: 14px 18px;
		border-left: 4px solid var(--highlight);
		background: var(--field);
		border-radius: 8px;
	}
	.keep {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px 24px;
		margin: 0 0 24px;
		padding: 14px 18px;
		border: 1px solid var(--line);
		border-radius: 8px;
	}
	.keep p {
		flex: 1 1 320px;
		margin: 0;
		color: var(--muted);
		font-size: var(--text-sm);
	}
	.keep.example {
		border-left: 4px solid var(--highlight);
	}
	.keep strong {
		color: var(--foreground);
		font-weight: 600;
	}
	.keep.warn {
		border-color: var(--error);
	}
	.keep.warn p {
		color: var(--foreground);
	}
	.confirm {
		margin-top: 20px;
		padding: 16px 18px;
		border: 1px solid var(--error);
		border-radius: 10px;
	}
	.confirm p {
		margin: 0;
	}
	.confirm .result-actions {
		margin-top: 12px;
	}
	.tool-section {
		padding: 40px 0;
		border-top: 1px solid var(--line);
	}
	h2 {
		display: flex;
		align-items: center;
		gap: 14px;
		margin: 0;
		font-size: var(--text-2xl);
		font-weight: 500;
		letter-spacing: -0.035em;
	}
	.number {
		display: inline-grid;
		place-items: center;
		flex: none;
		width: 34px;
		height: 34px;
		border-radius: 8px;
		background: var(--highlight);
		color: #000;
		font-size: var(--text-base);
		font-weight: 600;
		letter-spacing: 0;
	}
	h3 {
		margin: 32px 0 0;
		font-size: var(--text-lg);
		font-weight: 500;
	}
	.hint {
		max-width: 720px;
		margin: 12px 0 0;
		color: var(--muted);
		font-size: var(--text-sm);
	}
	.fields {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
		gap: 16px;
		margin-top: 20px;
	}
	.fields .wide {
		grid-column: span 2;
	}
	label {
		display: grid;
		align-content: start;
		gap: 6px;
		font-size: var(--text-sm);
		font-weight: 500;
	}
	label > span {
		color: var(--muted);
		font-weight: 400;
	}
	label.inline {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 12px;
	}
	label.check {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		margin-top: 20px;
		font-weight: 400;
	}
	label.check input {
		width: 18px;
		height: 18px;
		min-height: 0;
		margin: 2px 0 0;
		accent-color: var(--foreground);
	}
	input,
	select {
		width: 100%;
		min-width: 0;
		min-height: 44px;
		padding: 8px 12px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--background);
		color: var(--foreground);
		font: inherit;
		font-size: var(--text-base);
	}
	input:focus-visible,
	select:focus-visible,
	button:focus-visible {
		outline: 2px solid var(--foreground);
		outline-offset: 2px;
	}
	button {
		font: inherit;
		cursor: pointer;
	}
	button.small,
	button.primary {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 18px;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--background);
		color: var(--foreground);
		font-size: var(--text-sm);
		font-weight: 500;
	}
	button.small:hover:not(:disabled) {
		border-color: var(--foreground);
	}
	button.primary {
		min-height: 54px;
		padding: 0 26px;
		border: 0;
		background: var(--foreground);
		color: var(--background);
		font-size: var(--text-lg);
	}
	button:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}
	button.danger {
		border-color: var(--error);
		color: var(--error);
	}
	button.link {
		padding: 8px 0;
		border: 0;
		background: none;
		color: var(--muted);
		font-size: var(--text-sm);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	button.link:hover {
		color: var(--foreground);
	}
	.unit {
		margin: 24px 0 0;
		padding: 24px;
		border: 1px solid var(--line);
		border-radius: 14px;
	}
	.unit .fields:first-of-type {
		margin-top: 0;
	}
	.tenancy {
		margin-top: 24px;
		padding-top: 20px;
		border-top: 1px dashed var(--line);
	}
	.tenancy-title {
		margin: 0;
		font-weight: 500;
	}
	.tenancy .fields {
		margin-top: 12px;
	}
	.row-actions,
	.result-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px 20px;
		margin-top: 20px;
	}
	.lease-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	.edited {
		display: block;
		margin-top: 4px;
		color: var(--muted);
		font-size: var(--text-xs);
		text-align: right;
	}
	.stale-note {
		color: var(--error);
	}
	.result-actions .hint {
		margin: 0;
	}
	.tool-section > .small {
		margin-top: 20px;
	}
	.items {
		margin-top: 24px;
		border-top: 1px solid var(--line);
	}
	.item {
		border-bottom: 1px solid var(--line);
	}
	.item.filled {
		background: var(--field);
	}
	.item-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 170px 290px;
		align-items: center;
		gap: 16px;
		padding: 10px 12px;
	}
	.item-name {
		display: block;
		font-size: var(--text-base);
		font-weight: 500;
	}
	.item-name small {
		display: block;
		color: var(--muted);
		font-size: var(--text-xs);
		font-weight: 400;
	}
	.amount-field {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.amount-field input {
		text-align: right;
	}
	.amount-field span {
		color: var(--muted);
	}
	.item-details {
		padding: 0 12px 20px;
	}
	.item-details > .hint:first-child {
		margin-top: 0;
	}
	.total {
		margin: 16px 12px 0;
		text-align: right;
	}
	.findings {
		display: grid;
		gap: 10px;
		margin: 24px 0 0;
		padding: 0;
		list-style: none;
	}
	.findings li {
		padding: 12px 16px;
		border-left: 4px solid var(--muted);
		border-radius: 6px;
		background: var(--field);
		font-size: var(--text-sm);
	}
	.findings li.blocking {
		border-left-color: var(--error);
		color: var(--error);
	}
	.summary {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		margin: 28px 0 0;
		border-block: 1px solid var(--line);
	}
	.summary div {
		padding: 18px 16px;
	}
	.summary div + div {
		border-left: 1px solid var(--line);
	}
	.summary dt {
		color: var(--muted);
		font-size: var(--text-sm);
	}
	.summary dd {
		margin: 4px 0 0;
		font-size: var(--text-xl);
		font-weight: 500;
		letter-spacing: -0.02em;
	}
	.table-wrap {
		margin-top: 28px;
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-sm);
	}
	th,
	td {
		padding: 12px 10px;
		border-bottom: 1px solid var(--line);
		text-align: left;
		vertical-align: middle;
	}
	th {
		color: var(--muted);
		font-weight: 500;
	}
	td small {
		display: block;
		color: var(--muted);
	}
	.number-cell {
		text-align: right;
		white-space: nowrap;
	}
	.result-actions {
		margin-top: 28px;
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	@media (max-width: 760px) {
		.item-row {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		}
		.item-name {
			grid-column: 1 / -1;
		}
		.summary {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.summary div:nth-child(3) {
			border-left: 0;
		}
		.summary div:nth-child(n + 3) {
			border-top: 1px solid var(--line);
		}
	}
	@media (max-width: 600px) {
		.fields {
			grid-template-columns: minmax(0, 1fr);
		}
		.fields .wide {
			grid-column: auto;
		}
		.unit {
			padding: 16px;
		}
		thead {
			display: none;
		}
		tr,
		td {
			display: block;
		}
		td {
			padding: 2px 0;
			border-bottom: 0;
		}
		td.number-cell {
			text-align: left;
		}
		tr {
			padding: 14px 0;
			border-bottom: 1px solid var(--line);
		}
		.result-actions button.primary {
			width: 100%;
			justify-content: center;
		}
	}
</style>
