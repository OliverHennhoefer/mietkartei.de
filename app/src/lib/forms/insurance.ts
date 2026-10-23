import { insuranceKinds } from '../server/db/schema';
import type { InsurancePolicyInput } from '../server/insurance';
import { FormParser, type ParseResult } from './fields';

// Parses the form of the Versicherungen tab. The property comes from the route, never from the form.

export function parseInsurancePolicy(form: FormData): ParseResult<InsurancePolicyInput> {
	const parser = new FormParser<InsurancePolicyInput>(form);
	const kind = parser.oneOf('kind', insuranceKinds);
	const insurer = parser.text('insurer');
	const policyNumber = parser.optionalText('policyNumber', 100);
	const annualPremium = parser.money('annualPremium');
	const renewalDate = parser.date('renewalDate');
	const noticeMonths = parser.number('noticeMonths', { min: 0, max: 24, integer: true });
	const endDate = parser.date('endDate', { required: false });
	if (endDate && renewalDate && endDate < renewalDate) {
		parser.fail('endDate', 'Das Ende darf nicht vor der Hauptfälligkeit liegen.');
	}
	const note = parser.optionalText('note', 2000);
	return parser.result(() => ({
		kind: kind!,
		insurer,
		policyNumber,
		annualPremium: annualPremium!,
		renewalDate: renewalDate!,
		noticeMonths: noticeMonths!,
		endDate,
		note
	}));
}
