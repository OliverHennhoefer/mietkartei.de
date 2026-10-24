import { describe, expect, it } from 'vitest';
import { repeatLabel } from './task-templates';

describe('repeatLabel', () => {
	it('names the offered intervals and counts the months of any other', () => {
		expect(repeatLabel(12)).toBe('jährlich');
		expect(repeatLabel(24)).toBe('alle 2 Jahre');
		expect(repeatLabel(7)).toBe('alle 7 Monate');
	});
});
