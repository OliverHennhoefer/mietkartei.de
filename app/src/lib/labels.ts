import type { BuildingUse } from './server/db/schema';

// German labels for the enums in the schema, so every page uses the same words.

export const buildingUseLabels: Record<BuildingUse, string> = {
	residential: 'Wohngebäude',
	non_residential: 'Nichtwohngebäude'
};
