import type { PageServerLoad } from './$types';
import { loadFiltered } from '../period';

// Objekte im Vergleich: the figures of the period per property and per unit.

export const load: PageServerLoad = (event) => loadFiltered(event);
