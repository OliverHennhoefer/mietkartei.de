import { today } from '../dates';
import { emissionFactors } from '../domain/co2';
import { formatNumber } from '../format';
import { fuelLabels } from '../labels';
import { fuels } from '../server/db/schema';
import type { Co2SplitInput } from '../server/co2';
import { FormParser, type FieldErrors } from './fields';

// Parses the CO₂ split form of /vertraege/[id]/co2. The CO₂ kg are what the supplier printed on
// the invoice; when the field is empty and the fuel has an emission factor, the parser prefills
// the kg from the kWh and asks the user to confirm instead of saving (see PROTOTYPE.md "CO₂ cost
// split", the factor only prefills).

/** The first year the CO2KostAufG applies to (§ 1 Abs. 1: Abrechnungszeiträume ab 1.1.2023). */
export const FIRST_CO2_YEAR = 2023;

export type Co2SplitParseResult =
	| { ok: true; data: Co2SplitInput; values: Record<string, string> }
	| {
			ok: false;
			errors: FieldErrors<Co2SplitInput>;
			values: Record<string, string>;
			/** Set when the kg were prefilled from the kWh: the form is shown again with this text. */
			hint: string | null;
	  };

/** kWh × factor, rounded to one decimal; undefined when the fuel has no factor. */
export function prefillCo2Kg(fuel: string, fuelKwh: number): number | undefined {
	const factor = emissionFactors[fuel];
	if (factor === undefined) return undefined;
	return Math.round(fuelKwh * factor * 10) / 10;
}

/** A number for an input field: `5025.5` → `5025,5`, without thousands separators. */
export function numberInput(value: number): string {
	return String(Math.round(value * 100) / 100).replace('.', ',');
}

export function parseCo2Split(form: FormData, currentDate = today()): Co2SplitParseResult {
	const parser = new FormParser<Co2SplitInput>(form);
	const currentYear = Number(currentDate.slice(0, 4));

	const year = parser.number('year', { integer: true, min: 1900, max: 9999 });
	if (year !== null && year < FIRST_CO2_YEAR) {
		parser.fail('year', `Das CO2KostAufG gilt erst ab ${FIRST_CO2_YEAR}.`);
	} else if (year !== null && year > currentYear) {
		parser.fail('year', 'Das Jahr liegt in der Zukunft.');
	}

	const fuel = parser.oneOf('fuel', fuels);
	const fuelKwh = parser.number('fuelKwh', { required: false, min: 0 }) || null;

	let co2Kg = parser.number('co2Kg', { required: false, min: 0 });
	let hint: string | null = null;
	if (co2Kg === null && !parser.errors.co2Kg) {
		const prefilled = fuel && fuelKwh ? prefillCo2Kg(fuel, fuelKwh) : undefined;
		if (prefilled !== undefined && fuel) {
			parser.values.co2Kg = numberInput(prefilled);
			hint =
				`Aus ${formatNumber(fuelKwh!)} kWh ${fuelLabels[fuel]} ergeben sich ` +
				`${formatNumber(prefilled, 1)} kg CO₂. Prüfe den Wert gegen die Rechnung und speichere dann.`;
		} else {
			parser.fail('co2Kg', 'Bitte gib die CO₂-Menge an, die auf der Rechnung steht.');
		}
	} else if (co2Kg === 0) {
		parser.fail('co2Kg', 'Die CO₂-Menge muss größer als 0 sein.');
		co2Kg = null;
	}

	const co2Cost = parser.money('co2Cost');
	if (co2Cost === 0) parser.fail('co2Cost', 'Die CO₂-Kosten müssen größer als 0 sein.');

	const area = parser.number('area', { min: 0 });
	if (area === 0) parser.fail('area', 'Die Wohnfläche muss größer als 0 sein.');

	const invoiceDate = parser.date('invoiceDate', { required: false });
	const claimedOn = parser.date('claimedOn');
	if (claimedOn && invoiceDate && claimedOn < invoiceDate) {
		parser.fail('claimedOn', 'Die Geltendmachung liegt vor dem Rechnungsdatum.');
	}

	if (parser.hasErrors || hint !== null) {
		return { ok: false, errors: parser.errors, values: parser.values, hint };
	}
	return {
		ok: true,
		values: parser.values,
		data: {
			year: year!,
			fuel: fuel!,
			fuelKwh,
			co2Kg: co2Kg!,
			co2Cost: co2Cost!,
			area: area!,
			invoiceDate,
			claimedOn: claimedOn!
		}
	};
}
