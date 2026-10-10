/**
 * Seeded RNG (mulberry32). The state is a single uint32 stored on GameState, so
 * a game is fully reproducible from its seed and the sequence of player inputs.
 */

/** FNV-1a hash of the seed string into a uint32 starting state. */
export function seedToState(seed: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/** Returns a float in [0, 1) and the next RNG state. */
export function next(state: number): [number, number] {
	const s = (state + 0x6d2b79f5) >>> 0;
	let t = s;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	return [value, s];
}

/** Integer in [0, max). */
export function nextInt(state: number, max: number): [number, number] {
	const [v, s] = next(state);
	return [Math.floor(v * max), s];
}

/** Fisher-Yates shuffle; returns a new array and the next RNG state. */
export function shuffle<T>(state: number, items: readonly T[]): [T[], number] {
	const out = [...items];
	let s = state;
	for (let i = out.length - 1; i > 0; i--) {
		let j: number;
		[j, s] = nextInt(s, i + 1);
		[out[i], out[j]] = [out[j] as T, out[i] as T];
	}
	return [out, s];
}
