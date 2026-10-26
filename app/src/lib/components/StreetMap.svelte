<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { Map as LeafletMap } from 'leaflet';
	import { deviation } from '#lib/domain/rent-level.ts';
	import { pluralize } from '#lib/format.ts';
	import { needsAttention, type MapProperty } from '#lib/map/frame.ts';
	import { formatCents } from '#lib/money.ts';
	import { GERMANY_BOUNDS, TILE_ZOOMS } from '#lib/map/street-map.ts';

	// The interactive street map of the large map: Leaflet shows the tiles the server draws from
	// the street map (/objekte/karte/z/x/y), to drag and zoom from all of Germany down to the
	// houses, with every property as a dot: neon yellow, or orange with a vacant unit or a
	// Rückstand. A click on a dot shows its figures and the way to the property. Leaflet and its
	// styles load with the first map.
	let {
		properties,
		selected,
		version,
		wholeCountry
	}: {
		properties: MapProperty[];
		selected: string | undefined;
		/** The version of the street map, so the browser keeps its tiles until a new upload. */
		version: string;
		wholeCountry: boolean;
	} = $props();

	const NEON = '#f5ff00';
	const ATTENTION = '#ff8a2a';

	let host = $state<HTMLDivElement>();

	/** The figures of the properties at one dot, built as elements so no name is read as HTML. */
	function summary(at: MapProperty[]): HTMLElement {
		const box = document.createElement('div');
		const line = (parent: HTMLElement, text: string, className = '') => {
			const element = document.createElement('p');
			element.textContent = text;
			if (className) element.className = className;
			parent.append(element);
		};
		for (const property of at) {
			const entry = document.createElement('section');
			const link = document.createElement('a');
			const path = resolve('/objekte/[id]', { id: property.id });
			link.href = path;
			link.textContent = property.name;
			link.addEventListener('click', (event) => {
				event.preventDefault();
				goto(path);
			});
			entry.append(link);
			const vacant = property.vacantUnits ?? 0;
			line(
				entry,
				!property.unitCount
					? 'Noch keine Einheiten'
					: `${pluralize(property.unitCount, 'Einheit', 'Einheiten')} · ${
							vacant === 0 ? 'kein Leerstand' : `Leerstand: ${vacant}`
						}`,
				vacant > 0 ? 'warn' : ''
			);
			const facts = property.facts;
			if (facts && facts.overdue > 0)
				line(entry, `Rückstand: ${formatCents(facts.overdue)}`, 'warn');
			if (facts?.rentPerSquareMetre) {
				const average = facts.municipality?.rentPerSquareMetre;
				line(entry, `Kaltmiete ${formatCents(facts.rentPerSquareMetre)} je m²`);
				if (average && facts.municipality) {
					const difference = deviation(facts.rentPerSquareMetre, average);
					line(
						entry,
						`Zensus ${facts.municipality.name}: ${formatCents(average)} je m² (${
							difference > 0 ? '+' : ''
						}${difference.toLocaleString('de-DE')} %)`,
						'muted'
					);
				}
			}
			box.append(entry);
		}
		return box;
	}
	let map = $state<LeafletMap>();

	/** The properties by location; several at one address share a dot. */
	const places = $derived.by(() => {
		const byLocation: Record<string, { lat: number; lon: number; properties: MapProperty[] }> = {};
		for (const property of properties) {
			if (!property.location) continue;
			const { lat, lon } = property.location;
			byLocation[`${lat},${lon}`] ??= { lat, lon, properties: [] };
			byLocation[`${lat},${lon}`].properties.push(property);
		}
		return Object.values(byLocation);
	});

	$effect(() => {
		if (!host) return;
		const element = host;
		let created: LeafletMap | undefined;
		let cancelled = false;
		Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]).then(([leaflet]) => {
			if (cancelled) return;
			const L = leaflet.default;
			created = L.map(element, {
				minZoom: TILE_ZOOMS.min,
				maxZoom: TILE_ZOOMS.max,
				maxBounds: L.latLngBounds(GERMANY_BOUNDS).pad(0.15),
				zoomSnap: 0.5,
				zoomControl: false
			});
			L.control.zoom({ zoomInTitle: 'Vergrößern', zoomOutTitle: 'Verkleinern' }).addTo(created);
			created.attributionControl.setPrefix(false);
			L.tileLayer(`/objekte/karte/{z}/{x}/{y}?v=${encodeURIComponent(version)}`, {
				minZoom: TILE_ZOOMS.min,
				maxZoom: TILE_ZOOMS.max,
				attribution: '© OpenStreetMap-Mitwirkende'
			}).addTo(created);
			for (const place of places) {
				const chosen = place.properties.find((property) => property.id === selected);
				const shown = chosen ?? place.properties[0];
				const extra = place.properties.length > 1 ? ` +${place.properties.length - 1}` : '';
				// As text, not HTML: Leaflet would read a string as markup.
				const label = document.createElement('span');
				label.textContent = `${shown.name}${extra}`;
				const attention = place.properties.some(needsAttention);
				let byKeyboard = false;
				const marker = L.circleMarker([place.lat, place.lon], {
					radius: chosen ? 8 : 6,
					color: '#141414',
					weight: 2,
					fillColor: attention ? ATTENTION : NEON,
					fillOpacity: 1,
					className: `street-map-dot${chosen ? ' selected' : ''}${attention ? ' attention' : ''}`
				})
					.bindTooltip(label, {
						permanent: Boolean(chosen),
						direction: 'top',
						offset: [0, -8],
						className: 'street-map-label'
					})
					.bindPopup(() => summary(place.properties), {
						className: 'street-map-popup',
						offset: [0, -4]
					})
					// The figures take the place of the name while they are open; opened from the
					// keyboard, the focus moves to the first property and back to the dot after.
					.on('popupopen', (event) => {
						marker.closeTooltip();
						if (byKeyboard) event.popup.getElement()?.querySelector('a')?.focus();
					})
					.on('popupclose', () => {
						if (chosen) marker.openTooltip();
						if (byKeyboard) (marker.getElement() as SVGElement | undefined)?.focus();
						byKeyboard = false;
					})
					// Leaflet draws the dots as paths no key reaches; each becomes a button once the
					// map has its first view and draws it.
					.on('add', () => {
						const dot = marker.getElement();
						dot?.setAttribute('tabindex', '0');
						dot?.setAttribute('role', 'button');
						dot?.setAttribute(
							'aria-label',
							place.properties.map((property) => property.name).join(', ')
						);
						dot?.addEventListener('keydown', (event) => {
							const key = (event as KeyboardEvent).key;
							if (key !== 'Enter' && key !== ' ') return;
							event.preventDefault();
							byKeyboard = true;
							marker.openPopup();
						});
					})
					.addTo(created);
			}
			const legend = new L.Control({ position: 'bottomleft' });
			legend.onAdd = () => {
				const box = L.DomUtil.create('div', 'street-map-legend');
				for (const [color, text] of [
					[NEON, 'Alles vermietet, kein Rückstand'],
					[ATTENTION, 'Leerstand oder Rückstand']
				]) {
					const row = L.DomUtil.create('div', '', box);
					L.DomUtil.create('span', 'swatch', row).style.background = color;
					row.append(text);
				}
				return box;
			};
			legend.addTo(created);
			map = created;
		});
		return () => {
			cancelled = true;
			created?.remove();
			map = undefined;
		};
	});

	// Zoomed to the properties, the chosen one in the middle when it is the only one; or Germany.
	$effect(() => {
		if (!map) return;
		if (wholeCountry || places.length === 0) {
			map.fitBounds(GERMANY_BOUNDS);
		} else if (places.length === 1) {
			map.setView([places[0].lat, places[0].lon], 15);
		} else {
			map.fitBounds(
				places.map((place) => [place.lat, place.lon]),
				{ padding: [40, 40], maxZoom: 15 }
			);
		}
	});
</script>

<div class="street-map" bind:this={host} role="region" aria-label="Karte"></div>

<style>
	.street-map {
		width: 100%;
		height: 100%;
		background: var(--color-map-water);
	}
	.street-map :global(.leaflet-container),
	.street-map:global(.leaflet-container) {
		background: #141414;
		font-family: inherit;
	}
	.street-map :global(.leaflet-bar a) {
		border-color: #333;
		background: #1c1c1c;
		color: #e6e6e6;
	}
	.street-map :global(.leaflet-bar a:hover) {
		background: #2a2a2a;
	}
	.street-map :global(.leaflet-control-attribution) {
		background: rgb(20 20 20 / 80%);
		color: #9a9a9a;
	}
	.street-map :global(.street-map-dot) {
		cursor: pointer;
		outline: none;
	}
	.street-map :global(.street-map-dot:focus-visible) {
		stroke: #f2f2f2;
	}
	.street-map :global(.street-map-label) {
		border: 0;
		border-radius: 6px;
		background: #1c1c1c;
		box-shadow: none;
		color: #f2f2f2;
		font-weight: 500;
	}
	.street-map :global(.street-map-label::before) {
		border-top-color: #1c1c1c;
	}
	.street-map :global(.street-map-popup .leaflet-popup-content-wrapper),
	.street-map :global(.street-map-popup .leaflet-popup-tip) {
		background: #1c1c1c;
		color: #e6e6e6;
		box-shadow: 0 8px 24px rgb(0 0 0 / 40%);
	}
	.street-map :global(.street-map-popup .leaflet-popup-content) {
		margin: 0.75rem 0.9rem;
		font-size: 0.8rem;
		line-height: 1.4;
	}
	.street-map :global(.street-map-popup section + section) {
		margin-top: 0.6rem;
		padding-top: 0.6rem;
		border-top: 1px solid #333;
	}
	.street-map :global(.street-map-popup a) {
		color: #f5ff00;
		font-weight: 600;
	}
	.street-map :global(.street-map-popup p) {
		margin: 0.15rem 0 0;
	}
	.street-map :global(.street-map-popup .warn) {
		color: #ff8a2a;
	}
	.street-map :global(.street-map-popup .muted) {
		color: #9a9a9a;
	}
	.street-map :global(.leaflet-popup-close-button) {
		color: #9a9a9a;
	}
	.street-map :global(.street-map-legend) {
		padding: 0.4rem 0.6rem;
		border-radius: 6px;
		background: rgb(20 20 20 / 85%);
		color: #cfcfcf;
		font-size: 0.72rem;
		line-height: 1.6;
	}
	.street-map :global(.street-map-legend .swatch) {
		display: inline-block;
		width: 0.6rem;
		height: 0.6rem;
		margin-right: 0.4rem;
		border-radius: 50%;
	}
</style>
