/**
 * Mixed Persian/English text. Browsers pick a paragraph's direction from its
 * first letter (dir="auto"), so "Ana پیشنهاد مرا پذیرفته است." is laid out
 * left-to-right and reads scrambled. Instead we pick the direction from the
 * text's own language, ignoring player names, and isolate each name so its
 * neighbouring punctuation stays where it was written.
 */

const FSI = "\u2068"; // first strong isolate
const PDI = "\u2069"; // pop directional isolate

/** Wraps a value so it cannot reorder the text around it. */
export const isolate = (s: string) => `${FSI}${s}${PDI}`;

/** Isolates a value only if it has letters (a name); numbers need no isolation. */
export const isolateWords = (s: string) => (/\p{L}/u.test(s) ? isolate(s) : s);

/** The text without isolation marks (for initials, matching). */
export const stripIsolates = (s: string) => s.replace(/[\u2066-\u2069]/g, "");

const RTL_LETTER = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/gu;
const LTR_LETTER = /[A-Za-z\u00c0-\u024f]/g;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function namePattern(names: string[]): RegExp | null {
	const list = [
		...new Set(names.map((n) => stripIsolates(n).trim()).filter(Boolean)),
	].sort((a, b) => b.length - a.length);
	if (!list.length) return null;
	return new RegExp(
		`(?<![\\p{L}\\p{N}])(?:${list.map(escapeRe).join("|")})(?![\\p{L}\\p{N}])`,
		"gu",
	);
}

/** "rtl" or "ltr" by which script most of the text (names aside) is in; undefined if it has no letters. */
export function textDir(
	text: string,
	names: string[] = [],
): "rtl" | "ltr" | undefined {
	const re = namePattern(names);
	const body = re ? text.replace(re, " ") : text;
	const rtl = body.match(RTL_LETTER)?.length ?? 0;
	const ltr = body.match(LTR_LETTER)?.length ?? 0;
	if (!rtl && !ltr) return undefined;
	return rtl >= ltr ? "rtl" : "ltr";
}

/** Isolates every player name in a free-text line. */
export function isolateNames(text: string, names: string[]): string {
	const re = namePattern(names);
	return re ? text.replace(re, (m) => isolate(m)) : text;
}

/** Props for an element that shows one free-text line: its direction and its text. */
export function bidiProps(text: string, names: string[]) {
	return { dir: textDir(text, names), children: isolateNames(text, names) };
}
