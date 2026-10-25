import { describe, expect, it } from 'vitest';
import { bankOfIban } from './bank-codes';

describe('bankOfIban', () => {
	it('finds name and BIC of a German IBAN, with or without spaces', () => {
		expect(bankOfIban('DE89370400440532013000')).toEqual({
			name: 'Commerzbank',
			bic: 'COBADEFFXXX'
		});
		expect(bankOfIban('de02 1203 0000 0000 2020 51')).toEqual({
			name: 'Deutsche Kreditbank Berlin',
			bic: 'BYLADEM1001'
		});
	});

	it('knows nothing of foreign IBANs and unknown sort codes', () => {
		expect(bankOfIban('AT611904300234573201')).toBeNull();
		expect(bankOfIban('DE00999999990000000000')).toBeNull();
		expect(bankOfIban('')).toBeNull();
	});
});
