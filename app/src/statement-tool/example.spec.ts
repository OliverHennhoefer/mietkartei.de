import { describe, expect, it } from 'vitest';
import { computeTool } from '../lib/domain/statement-tool';
import { exampleToolState } from './example';

describe('example', () => {
	it('computes a statement for every tenant without blocking issues', () => {
		const today = '2026-03-01';
		const result = computeTool(exampleToolState(today), today);
		expect(result.issues.filter((issue) => issue.blocking)).toEqual([]);
		expect(result.statement?.leases.map((lease) => lease.tenants[0].lastName).sort()).toEqual([
			'Krüger',
			'Schulz',
			'Weber',
			'Yilmaz'
		]);
		expect(result.statement?.leases.every((lease) => lease.lines.length >= 8)).toBe(true);
	});
});
