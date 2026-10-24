import { and, eq } from 'drizzle-orm';
import { auditEntry, type AuditContext } from './audit';
import { generateToken, hashToken } from './auth';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { accounts, leases, portalLinks, properties, units } from './db/schema';
import type { Mail } from './mail';

// Mieterportal: a page the tenants of a lease open through a link, without an account, to report
// damage and follow their reports. The link holds a random token, the database only its SHA-256,
// so a copy of the database opens no portal. The landlord sees a link once, when it is made;
// making a new one locks the old one out, and so does revoking it.

/** The lease's portal link, without its token: whether there is one, and since when. */
export async function getPortalLink(
	db: Database,
	accountId: string,
	leaseId: string
): Promise<{ createdAt: Date } | undefined> {
	const [link] = await db
		.select({ createdAt: portalLinks.createdAt })
		.from(portalLinks)
		.where(and(eq(portalLinks.accountId, accountId), eq(portalLinks.leaseId, leaseId)));
	return link;
}

/** "EG links · Haus" for audit summaries, or undefined when the lease is not in the account. */
async function leaseName(db: Database, accountId: string, leaseId: string) {
	const [row] = await db
		.select({ unitName: units.name, propertyName: properties.name })
		.from(leases)
		.innerJoin(units, eq(leases.unitId, units.id))
		.innerJoin(properties, eq(units.propertyId, properties.id))
		.where(and(eq(leases.accountId, accountId), eq(leases.id, leaseId)));
	return row && `${row.unitName} · ${row.propertyName}`;
}

/**
 * Makes a new portal link for the lease and returns its token, which is never stored. An older
 * link of the lease stops working. Undefined when the lease is not in the account.
 */
export async function createPortalLink(
	db: Database,
	context: AuditContext,
	leaseId: string
): Promise<string | undefined> {
	const { accountId } = context;
	const name = await leaseName(db, accountId, leaseId);
	if (!name) return undefined;
	const token = generateToken();
	const id = crypto.randomUUID();
	await runBatch(db, [
		db
			.delete(portalLinks)
			.where(and(eq(portalLinks.accountId, accountId), eq(portalLinks.leaseId, leaseId))),
		db.insert(portalLinks).values({ id, accountId, leaseId, tokenHash: await hashToken(token) }),
		auditEntry(
			db,
			context,
			'portalLink',
			leaseId,
			'create',
			`Mieterportal-Link für ${name} erzeugt`
		)
	]);
	return token;
}

/** Locks the lease's portal link out. False when the lease has none. */
export async function revokePortalLink(
	db: Database,
	context: AuditContext,
	leaseId: string
): Promise<boolean> {
	const { accountId } = context;
	if (!(await getPortalLink(db, accountId, leaseId))) return false;
	const name = (await leaseName(db, accountId, leaseId)) ?? 'einen Mietvertrag';
	await runBatch(db, [
		db
			.delete(portalLinks)
			.where(and(eq(portalLinks.accountId, accountId), eq(portalLinks.leaseId, leaseId))),
		auditEntry(
			db,
			context,
			'portalLink',
			leaseId,
			'delete',
			`Mieterportal-Link für ${name} gesperrt`
		)
	]);
	return true;
}

/** What the portal page knows about the lease behind a link: no names, amounts or documents. */
export type Portal = {
	accountId: string;
	leaseId: string;
	unitName: string;
	propertyName: string;
	address: string;
	/** The landlord as printed on letters, else the account's name. */
	landlord: string;
};

/** The portal a token opens, or undefined when no link has it. */
export async function findPortal(db: Database, token: string): Promise<Portal | undefined> {
	// Tokens are 43 characters of base64url; anything else cannot be one.
	if (!/^[\w-]{20,100}$/.test(token)) return undefined;
	const [row] = await db
		.select({
			accountId: portalLinks.accountId,
			leaseId: portalLinks.leaseId,
			unitName: units.name,
			propertyName: properties.name,
			street: properties.street,
			postalCode: properties.postalCode,
			city: properties.city,
			landlordName: accounts.landlordName,
			accountName: accounts.name
		})
		.from(portalLinks)
		.innerJoin(leases, eq(portalLinks.leaseId, leases.id))
		.innerJoin(units, eq(leases.unitId, units.id))
		.innerJoin(properties, eq(units.propertyId, properties.id))
		.innerJoin(accounts, eq(portalLinks.accountId, accounts.id))
		.where(eq(portalLinks.tokenHash, await hashToken(token)));
	if (!row) return undefined;
	return {
		accountId: row.accountId,
		leaseId: row.leaseId,
		unitName: row.unitName,
		propertyName: row.propertyName,
		address: `${row.street}, ${row.postalCode} ${row.city}`,
		landlord: row.landlordName || row.accountName
	};
}

/** The mail that gives a tenant the portal link of their lease. */
export function portalLinkMail(
	to: string,
	portal: { unitName: string; propertyName: string; landlord: string },
	link: string
): Mail {
	return {
		to,
		subject: `Mieterportal für ${portal.unitName} · ${portal.propertyName}`,
		text:
			'Guten Tag,\n\n' +
			`${portal.landlord} hat für Ihre Wohnung ${portal.unitName} (${portal.propertyName}) ein ` +
			'Mieterportal eingerichtet. Darüber können Sie Schäden und Mängel melden, Fotos anhängen und ' +
			'sehen, wie weit Ihre Meldungen sind:\n\n' +
			`${link}\n\n` +
			'Der Link ist persönlich und braucht kein Passwort. Bitte geben Sie ihn nicht weiter. ' +
			'In Notfällen wie einem Wasserrohrbruch rufen Sie bitte zusätzlich direkt an.\n'
	};
}
