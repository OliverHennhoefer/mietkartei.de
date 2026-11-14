import { describe, expect, it } from 'vitest';
import { keepBackupLine } from './backup';

// Lines as `wrangler d1 export` writes them.
const audit = (entity: string, summary = "'Mieter Erika Muster angelegt'") =>
	`INSERT INTO "audit_log" ("id","account_id","user_id","created_at","entity","entity_id","action","summary") VALUES('l1','a1',NULL,1794676145979,'${entity}','x','create',${summary});`;

describe('keepBackupLine', () => {
	it('leaves out the rows of lettings and applicants but keeps their schema', () => {
		expect(
			keepBackupLine(
				`INSERT INTO "applicants" ("id","account_id","first_name") VALUES('p1','a1','Miriam');`
			)
		).toBe(false);
		expect(keepBackupLine(`INSERT INTO "lettings" ("id") VALUES('l1');`)).toBe(false);
		expect(keepBackupLine('CREATE TABLE `applicants` (')).toBe(true);
		expect(
			keepBackupLine('CREATE INDEX `applicants_account_id_idx` ON `applicants` (`account_id`);')
		).toBe(true);
		expect(keepBackupLine(`INSERT INTO "accounts" ("id","name") VALUES('a1','Konto');`)).toBe(true);
		expect(keepBackupLine('PRAGMA defer_foreign_keys=TRUE;')).toBe(true);
		expect(keepBackupLine('')).toBe(true);
	});

	it('leaves out the log lines of applicants and keeps all others', () => {
		expect(keepBackupLine(audit('applicant'))).toBe(false);
		expect(
			keepBackupLine(
				audit('applicant', "replace('Zeile\\nmit Umbruch, und ''Quote''','\\n',char(10))")
			)
		).toBe(false);
		expect(keepBackupLine(audit('tenant'))).toBe(true);
		expect(keepBackupLine(audit('letting'))).toBe(true);
		// A quote in an earlier value does not shift the columns.
		expect(
			keepBackupLine(
				`INSERT INTO "audit_log" ("id","account_id","entity","summary") VALUES('it''s','a1','applicant','x');`
			)
		).toBe(false);
		// What the parser does not understand stays in the copy.
		expect(
			keepBackupLine(
				`INSERT INTO "audit_log" ("id","account_id","entity") VALUES(x'00','a1','applicant');`
			)
		).toBe(true);
		expect(keepBackupLine(`INSERT INTO "audit_log" ("id","account_id") VALUES('l1','a1');`)).toBe(
			true
		);
		expect(keepBackupLine(`INSERT INTO "audit_log" ("id","entity") VALUES('l1`)).toBe(true);
	});
});
