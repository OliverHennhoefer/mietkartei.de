// Where uploaded documents are kept: a directory on the node target, an R2 bucket on cloudflare.
// Keys are `<accountId>/<documentId>` so an account's files can never be addressed by another.

export interface Storage {
	put(key: string, body: Uint8Array | ReadableStream, contentType: string): Promise<void>;
	/** Undefined when the key does not exist. */
	get(
		key: string
	): Promise<{ body: ReadableStream; contentType: string; size: number } | undefined>;
	/** Missing keys are fine. */
	delete(key: string): Promise<void>;
	/**
	 * Deletes up to MAX_DELETE_KEYS keys in one call (one R2 subrequest); missing keys are fine.
	 * Account deletion uses it, so an account with many documents stays within the Workers
	 * subrequest limit.
	 */
	deleteMany(keys: string[]): Promise<void>;
}

/** R2's limit for one bulk delete. */
export const MAX_DELETE_KEYS = 1000;

let storage: Promise<Storage> | undefined;

export function getStorage(): Promise<Storage> {
	storage ??= (async () => {
		if (__DEPLOY_TARGET__ === 'cloudflare') {
			const { openR2 } = await import('./r2');
			return openR2();
		}
		const { openFileStorage } = await import('./fs');
		return openFileStorage();
	})();
	return storage;
}

export function storageKey(accountId: string, documentId: string): string {
	return `${accountId}/${documentId}`;
}
