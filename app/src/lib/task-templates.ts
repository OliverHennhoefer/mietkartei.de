import type { TaskCategory } from './server/db/schema';

// Repeat intervals offered by the task form, and templates for the recurring duties of a
// landlord. A template only fills the form; the stored task does not remember it.

export const repeatOptions: { months: number; label: string }[] = [
	{ months: 1, label: 'monatlich' },
	{ months: 3, label: 'vierteljährlich' },
	{ months: 6, label: 'halbjährlich' },
	{ months: 12, label: 'jährlich' },
	{ months: 24, label: 'alle 2 Jahre' },
	{ months: 36, label: 'alle 3 Jahre' },
	{ months: 48, label: 'alle 4 Jahre' },
	{ months: 60, label: 'alle 5 Jahre' },
	{ months: 72, label: 'alle 6 Jahre' },
	{ months: 120, label: 'alle 10 Jahre' }
];

/** "jährlich", "alle 2 Jahre"; an interval outside the options reads "alle 7 Monate". */
export function repeatLabel(months: number): string {
	return repeatOptions.find((option) => option.months === months)?.label ?? `alle ${months} Monate`;
}

export type TaskTemplate = {
	key: string;
	title: string;
	category: TaskCategory;
	repeatMonths: number;
	note: string;
};

export const taskTemplates: TaskTemplate[] = [
	{
		key: 'rauchwarnmelder',
		title: 'Rauchwarnmelder prüfen',
		category: 'inspection',
		repeatMonths: 12,
		note: 'Jährliche Inspektion und Wartung nach DIN 14676; die Pflicht regelt die Landesbauordnung.'
	},
	{
		key: 'heizungswartung',
		title: 'Heizung warten lassen',
		category: 'maintenance',
		repeatMonths: 12,
		note: 'Die Kosten der Wartung sind als Heizkosten umlagefähig (§ 2 Nr. 4 BetrKV).'
	},
	{
		key: 'schornsteinfeger',
		title: 'Schornsteinfeger: Kehrung und Messung',
		category: 'inspection',
		repeatMonths: 12,
		note: 'Termine und Umfang stehen im Feuerstättenbescheid; die Feuerstättenschau kommt zweimal in sieben Jahren.'
	},
	{
		key: 'legionellen',
		title: 'Trinkwasser auf Legionellen untersuchen',
		category: 'inspection',
		repeatMonths: 36,
		note: 'Pflicht für Großanlagen zur Trinkwassererwärmung mit Duschen in vermieteten Gebäuden (TrinkwV), in der Regel alle drei Jahre.'
	},
	{
		key: 'eichfrist',
		title: 'Wasser- und Wärmezähler tauschen (Eichfrist)',
		category: 'maintenance',
		repeatMonths: 60,
		note: 'Eichfrist nach MessEV: Warmwasser- und Wärmezähler 5 Jahre, Kaltwasserzähler 6 Jahre. Die Frist endet mit dem Kalenderjahr.'
	},
	{
		key: 'rueckstau',
		title: 'Rückstausicherung warten',
		category: 'maintenance',
		repeatMonths: 6,
		note: 'Wartung nach DIN EN 13564 und DIN 1986-3, in der Regel halbjährlich.'
	},
	{
		key: 'feuerloescher',
		title: 'Feuerlöscher prüfen lassen',
		category: 'inspection',
		repeatMonths: 24,
		note: 'Prüfung durch einen Sachkundigen nach DIN 14406-4, spätestens alle zwei Jahre.'
	},
	{
		key: 'dachrinnen',
		title: 'Dachrinnen reinigen',
		category: 'maintenance',
		repeatMonths: 12,
		note: 'Am besten im Spätherbst, nach dem Laubfall.'
	},
	{
		key: 'gebaeudeversicherung',
		title: 'Wohngebäudeversicherung prüfen',
		category: 'insurance',
		repeatMonths: 12,
		note: 'Versicherungssumme, Beitrag und Kündigungsfrist vor der Hauptfälligkeit prüfen.'
	}
];
