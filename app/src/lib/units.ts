export const unitKinds = ['apartment', 'commercial', 'parking'] as const;
export type UnitKind = (typeof unitKinds)[number];

export const unitKindLabels: Record<UnitKind, string> = {
	apartment: 'Wohnung',
	commercial: 'Gewerbe',
	parking: 'Stellplatz'
};
