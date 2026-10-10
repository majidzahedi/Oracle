/**
 * Session tokens live per browser tab (sessionStorage), so four tabs in one
 * browser can be four different players. Email sign-ins are also remembered in
 * localStorage, so a new tab starts as that account unless the player switches
 * to a fresh guest for the tab.
 */
const KEY = "oracle.token";

function read(storage: () => Storage): string | null {
	try {
		return storage().getItem(KEY);
	} catch {
		return null;
	}
}

function write(storage: () => Storage, value: string | null) {
	try {
		if (value === null) storage().removeItem(KEY);
		else storage().setItem(KEY, value);
	} catch {
		// storage unavailable: the session lasts until reload
	}
}

const session = () => sessionStorage;
const local = () => localStorage;

export function getToken(): string | null {
	const tab = read(session);
	// An empty string marks "this tab deliberately has no session".
	if (tab !== null) return tab || null;
	return read(local);
}

export function saveToken(token: string, opts: { remember: boolean }) {
	write(session, token);
	if (opts.remember) write(local, token);
}

/** Is the current token the remembered (cross-tab) one? */
export function isRememberedToken(): boolean {
	const l = read(local);
	return l !== null && l === getToken();
}

export function clearToken() {
	if (isRememberedToken()) write(local, null);
	write(session, "");
}

/** Detach this tab from any remembered account, e.g. to join as another guest. */
export function detachTab() {
	write(session, "");
}
