import { afterNavigate } from '$app/navigation';

/**
 * A form whose action redirects back to its own page keeps the page, and with it the values typed
 * into the form. Keyed on `visit` ({#key fresh.visit}), the form starts anew after every
 * navigation, so the next entry begins empty (or with its defaults). A failed submit does not
 * navigate and keeps what was typed. Create it while the component initialises.
 */
export class FreshForm {
	visit = $state(0);

	constructor() {
		afterNavigate(({ type }) => {
			if (type !== 'enter') this.visit += 1;
		});
	}
}
