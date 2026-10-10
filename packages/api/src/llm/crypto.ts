/**
 * AES-GCM encryption for stored API keys. The key is derived from the server
 * secret (BETTER_AUTH_SECRET), so the database alone never reveals a key.
 * Format: base64(iv).base64(ciphertext+tag).
 */
const enc = new TextEncoder();
const b64 = (b: ArrayBuffer | Uint8Array) =>
	Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString(
		"base64",
	);

async function keyFor(secret: string): Promise<CryptoKey> {
	const raw = await crypto.subtle.digest(
		"SHA-256",
		enc.encode(`${secret}:oracle-llm-api-keys`),
	);
	return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
		"encrypt",
		"decrypt",
	]);
}

export async function encryptSecret(
	plain: string,
	secret: string,
): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const data = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		await keyFor(secret),
		enc.encode(plain),
	);
	return `${b64(iv)}.${b64(data)}`;
}

export async function decryptSecret(
	stored: string,
	secret: string,
): Promise<string> {
	const [iv, data] = stored.split(".");
	if (!iv || !data) throw new Error("malformed secret");
	const plain = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: Buffer.from(iv, "base64") },
		await keyFor(secret),
		Buffer.from(data, "base64"),
	);
	return new TextDecoder().decode(plain);
}
