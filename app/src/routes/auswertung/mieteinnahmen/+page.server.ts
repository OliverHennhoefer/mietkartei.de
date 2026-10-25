import type { PageServerLoad } from './$types';
import { loadFiltered } from '../period';

// Mieteinnahmen: rent charged and received over all years, for the portfolio or one property.

export const load: PageServerLoad = (event) => loadFiltered(event, { period: 'all' });
