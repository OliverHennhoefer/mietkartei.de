import { mount } from 'svelte';
import StatementTool from './StatementTool.svelte';

// The free statement tool on mietkartei.de/nebenkostenabrechnung/erstellen/. The page shows a
// note in #rechner for browsers without JavaScript; the tool replaces it.
const target = document.getElementById('rechner');
if (target) {
	target.replaceChildren();
	mount(StatementTool, { target });
}
