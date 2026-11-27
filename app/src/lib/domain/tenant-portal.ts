import { addMonths, type IsoDate } from '../dates';
import { landlordLine, type Landlord } from './applicants';

// Mieterportal: what the secret link of a lease opens for its tenants, and how long. The rules
// here are pure; the server module (server/tenant-portal.ts) applies them to the rows.

/** The link keeps working this many months after the lease ends, for the last statement. */
export const PORTAL_MONTHS_AFTER_END = 12;
/** Zählerstände a lease may have waiting for the landlord, so a link cannot flood the account. */
export const MAX_OPEN_METER_REPORTS = 20;
/** Open Schadensmeldungen of a lease, for the same reason. */
export const MAX_OPEN_DAMAGE_REPORTS = 10;
/** Photos one Schadensmeldung may carry. */
export const MAX_DAMAGE_PHOTOS = 3;

/** The path of the portal page of a token. */
export const portalPath = (token: string) => `/mieterportal/${token}`;

/** The last day the link opens the portal: open-ended while the lease runs. */
export function portalOpenUntil(endDate: IsoDate | null): IsoDate | null {
	return endDate ? addMonths(endDate, PORTAL_MONTHS_AFTER_END) : null;
}

/** Whether the portal of a lease ending on `endDate` still opens on `day`. */
export function portalOpenOn(endDate: IsoDate | null, day: IsoDate): boolean {
	const until = portalOpenUntil(endDate);
	return until === null || day <= until;
}

/**
 * Datenschutzhinweis nach Art. 13 DSGVO for the tenants on the portal page. The landlord is the
 * controller; the software and its hosting are processors.
 */
export function portalPrivacyNotice(landlord: Landlord): string[] {
	return [
		`Verantwortlich für diese Seite und Ihre Angaben ist ${landlordLine(landlord) || 'Ihr Vermieter'}.`,
		'Hier sehen Sie Abrechnungen und Dokumente zu Ihrem Mietvertrag. Was Sie melden, also Zählerstände, Schäden, Fotos, Ihren Namen und eine Telefonnummer für Rückfragen, nutzt der Vermieter nur für das Mietverhältnis: für die Abrechnung der Betriebs- und Heizkosten und um Schäden zu beheben (Art. 6 Abs. 1 lit. b und c DSGVO). Die Angaben sind freiwillig; Sie können Zählerstände und Schäden auch auf anderem Weg mitteilen.',
		`Der Vermieter speichert die Angaben in der Mietverwaltung mietkartei. Der Betreiber der Software und dessen Hosting-Anbieter verarbeiten sie nur im Auftrag des Vermieters (Art. 28 DSGVO). Die Angaben bleiben, solange sie für das Mietverhältnis und die gesetzlichen Aufbewahrungsfristen nötig sind. Der Link gilt, solange der Mietvertrag läuft, und noch ${PORTAL_MONTHS_AFTER_END} Monate nach seinem Ende. Die Seite setzt keine Cookies und speichert nichts in Ihrem Browser.`,
		'Sie haben das Recht auf Auskunft, Berichtigung, Löschung und Einschränkung der Verarbeitung sowie auf Widerspruch (Art. 15 bis 21 DSGVO). Wenden Sie sich dazu an den Vermieter. Sie können sich außerdem bei einer Datenschutz-Aufsichtsbehörde beschweren.'
	];
}

/** The note of the repair task a Schadensmeldung becomes. */
export function damageNote(report: {
	description: string;
	reporter: string;
	phone: string | null;
	reportedOn: string;
}): string {
	const contact = report.phone ? `, Rückruf unter ${report.phone}` : '';
	return `${report.description}\n\nGemeldet über das Mieterportal von ${report.reporter} am ${report.reportedOn}${contact}.`;
}
