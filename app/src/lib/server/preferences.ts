import { eq } from 'drizzle-orm';
import type { Database } from './db/index.ts';
import { users, type Theme } from './db/schema.ts';

// Display preferences of each user; they change only how the app looks to that user.

/** Whether the user sees the small maps in the property list; true for an unknown user. */
export async function showsPropertyMaps(db: Database, userId: string): Promise<boolean> {
	const [user] = await db
		.select({ showPropertyMaps: users.showPropertyMaps })
		.from(users)
		.where(eq(users.id, userId));
	return user?.showPropertyMaps ?? true;
}

export async function setShowPropertyMaps(
	db: Database,
	userId: string,
	show: boolean
): Promise<void> {
	await db.update(users).set({ showPropertyMaps: show }).where(eq(users.id, userId));
}

export async function setTheme(db: Database, userId: string, theme: Theme): Promise<void> {
	await db.update(users).set({ theme }).where(eq(users.id, userId));
}
