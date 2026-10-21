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
	 * Deletes every object whose key starts with `prefix`, which ends in `/` (see accountPrefix).
	 * Account deletion uses it: it finds what was stored, not only what the rows knew of.
	 */
	deletePrefix(prefix: string): Promise<void>;
}

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

/** The start of every key of the account. */
export function accountPrefix(accountId: string): string {
	return `${accountId}/`;
}
