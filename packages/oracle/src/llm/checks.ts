import { type Claim, claimSubjects } from "@oracle/engine";

import type { Names } from "../render";

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const toPersianDigits = (n: number) =>
	String(n).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)] ?? d);
const mentions = (text: string, name: string) =>
	text.toLocaleLowerCase().includes(name.toLocaleLowerCase());

function innerClaim(claim: Claim): Claim {
	let c = claim;
	while (c.type === "not") c = c.claim;
	return c;
}

/**
 * Deterministic text checks: the text names exactly the claim's player (the
 * recipient may also be addressed), uses names rather than ids, and gives the
 * round for playedOffType. Meaning is checked separately by the verifier.
 */
export function checkText(
	text: string,
	claim: Claim,
	names: Names,
	opts: { allowNamed?: string[] } = {},
): string[] {
	const problems: string[] = [];
	if (!text.trim()) return ["the text is empty"];
	if (text.length > 400)
		problems.push("the text is too long (max ~2 sentences)");
	if (/\bp[1-4]\b/i.test(text))
		problems.push("use player names, not ids like p2");
	const subjects = claimSubjects(claim);
	for (const s of subjects) {
		const name = names[s];
		if (name && !mentions(text, name))
			problems.push(`the text must name ${name}`);
	}
	for (const [id, name] of Object.entries(names)) {
		if (subjects.includes(id) || opts.allowNamed?.includes(id)) continue;
		if (mentions(text, name))
			problems.push(`the text must not name ${name} (only the claim's player)`);
	}
	const c = innerClaim(claim);
	if (
		c.type === "playedOffType" &&
		!text.includes(String(c.round)) &&
		!text.includes(toPersianDigits(c.round))
	) {
		problems.push(`the text must mention round ${c.round} in digits`);
	}
	return problems;
}
