import type { PageServerLoad } from './$types';
import { loadFiltered } from './period';

// Überblick: the key figures, the course of the period and where the money went.

export const load: PageServerLoad = (event) => loadFiltered(event);
