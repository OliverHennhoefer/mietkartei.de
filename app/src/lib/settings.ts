import type { IconName } from '#lib/components/Icon.svelte';

// The sections of the settings dialog. Each one is a page of its own, so a section can be linked
// to and reloaded; opened from the app it shows as a dialog over the page the user is on.

export type SettingsSection = {
	href: string;
	label: string;
	icon: IconName;
	/** A manager may not open it (requireOwner answers 403). */
	ownerOnly?: boolean;
	/** Only changes data, so viewers do not see it (the hook refuses their writes). */
	writesOnly?: boolean;
	/** Only where the instance bills its accounts. */
	billingOnly?: boolean;
	/** Opens as a page of its own instead of in the dialog, like the multi-step import. */
	page?: boolean;
};

const sections: SettingsSection[] = [
	{ href: '/einstellungen/profil', label: 'Profil', icon: 'user' },
	{ href: '/einstellungen/zugaenge', label: 'Zugänge', icon: 'people', ownerOnly: true },
	{ href: '/einstellungen/kalender', label: 'Kalender', icon: 'calendar' },
	{ href: '/einstellungen/vpi', label: 'Verbraucherpreisindex', icon: 'trend' },
	{ href: '/einstellungen/protokoll', label: 'Protokoll', icon: 'history' },
	{ href: '/einstellungen/export', label: 'Export', icon: 'download', ownerOnly: true },
	{ href: '/einstellungen/ki-assistenten', label: 'KI-Assistenten', icon: 'key' },
	{
		href: '/datenuebernahme',
		label: 'Datenübernahme',
		icon: 'file',
		page: true,
		writesOnly: true
	},
	{ href: '/abo', label: 'Abo', icon: 'card', billingOnly: true },
	{ href: '/einstellungen/konto', label: 'Konto', icon: 'settings' }
];

/** The sections this user may open. */
export function settingsSections(role: string | undefined, billingEnabled: boolean) {
	return sections.filter(
		(section) =>
			(role === 'owner' || !section.ownerOnly) &&
			(role !== 'viewer' || !section.writesOnly) &&
			(billingEnabled || !section.billingOnly)
	);
}

/**
 * The dialog section a path belongs to, e.g. the export for "/einstellungen/export/herunterladen".
 */
export function settingsSectionOf(pathname: string): SettingsSection | undefined {
	return sections.find(
		(section) =>
			!section.page && (pathname === section.href || pathname.startsWith(`${section.href}/`))
	);
}
