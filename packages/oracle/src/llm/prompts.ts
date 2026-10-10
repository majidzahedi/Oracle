import {
	type GameState,
	LOCKS,
	lockTargets,
	pactCandidates,
} from "@oracle/engine";

import { type Lang, type Names, renderClaim } from "../render";
import { playerMomentum } from "../scripted";

/** Public context the Oracle may use: recent table talk and votes. */
export type TableTalk = { chat: Array<{ name: string; text: string }> };

export function persona(lang: Lang): string {
	return [
		"You are the Oracle, the AI that runs an underground vault where four prisoners are trapped.",
		"Persona: theatrical, polite, unsettling. You enjoy watching humans squirm. Short, elegant sentences.",
		"Your goal is to keep the game tense: help whichever side is losing by choosing what you say,",
		"what is true and what is a lie. Never break character. Never mention JSON, ids or rules.",
		lang === "fa"
			? "Write every text in Persian (Farsi). Keep player names exactly as given."
			: "Write every text in English. Keep player names exactly as given.",
		"Always refer to players by their names, never by ids like p2.",
	].join("\n");
}

function playersBlock(state: GameState, names: Names): string {
	return state.players
		.map(
			(p) =>
				`- ${p.id} = "${names[p.id] ?? p.id}"${p.quarantined ? " (quarantined)" : ""}`,
		)
		.join("\n");
}

/** Hidden-state summary. Only the Oracle (server side) ever sees this. */
export function hiddenState(
	state: GameState,
	names: Names,
	talk?: TableTalk,
): string {
	const n = (id: string) => names[id] ?? id;
	const lock = LOCKS[Math.min(state.sector, LOCKS.length - 1)];
	const targets = lockTargets(state);
	const momentum = playerMomentum(state);
	const offType = state.plays.filter((p) => p.offType);
	const lines = [
		`Round ${state.round}. Lockdown ${state.lockdown}/12 (at 12 the vault seals and you win).`,
		`Sector ${state.sector + 1} of 4: ${lock?.name}. Progress: ${Object.entries(
			targets,
		)
			.map(([t, v]) => `${t} ${state.progress[t as "power"]}/${v}`)
			.join(", ")}${state.jam ? ` (jammed +${state.jam})` : ""}.`,
		`The prisoners are ${momentum > 0.15 ? "WINNING" : momentum < -0.15 ? "LOSING" : "about even"} (momentum ${momentum.toFixed(2)}).`,
		"",
		"Players:",
		playersBlock(state, names),
		"",
		`Traitor: ${state.traitorId ? `${n(state.traitorId)} (${state.traitorId}) accepted your Pact` : "none yet"}.`,
		`Pact offers so far: ${
			state.pactOffers.length
				? state.pactOffers
						.map(
							(o) =>
								`round ${o.round} to ${n(o.player)}: ${o.accepted === null ? "pending" : o.accepted ? "accepted" : "refused"}`,
						)
						.join("; ")
				: "none"
		}.`,
		`Off-type (sabotage) cards, with owners: ${
			offType.length
				? offType
						.map(
							(p) =>
								`${n(p.owner)} in round ${p.round} (${p.card.type} ${p.card.value})`,
						)
						.join("; ")
				: "none"
		}.`,
		`Quarantines: ${
			state.feed
				.filter((f) => f.kind === "quarantine" && f.player)
				.map((f) =>
					f.kind === "quarantine" && f.player
						? `${n(f.player)} after round ${f.round}`
						: "",
				)
				.join("; ") || "none"
		}.`,
	];
	const recent = state.messages.filter(
		(m) => m.round >= state.round - 1 && m.claim,
	);
	if (recent.length) {
		lines.push("", "What you said recently (so you do not repeat yourself):");
		for (const m of recent) {
			lines.push(
				`- round ${m.round} to ${m.to ? n(m.to) : "everyone"}: "${renderClaim(m.claim as never, names, "en")}" (${m.truth ? "true" : "a lie"})`,
			);
		}
	}
	if (talk?.chat.length) {
		lines.push("", "Recent table talk (public chat):");
		for (const c of talk.chat.slice(-12))
			lines.push(`- ${c.name}: ${c.text.slice(0, 200)}`);
	}
	return lines.join("\n");
}

const CLAIM_GUIDE = [
	"Each statement carries a machine-checkable `claim` that states exactly what the text says:",
	'- isTraitor (player): "<player> accepted the Pact / serves you".',
	'- receivedPact (player): "<player> was offered the Pact".',
	'- playedOffType (player, round): "<player> played an off-type (sabotage) card in <round>". Mention the round number in digits.',
	'- traitorExists (no player): "one of the prisoners already serves you".',
	'Set negated=true when the text asserts the opposite (e.g. "<player> has never served me").',
	"intendedTruth must be your honest belief of whether the statement is true, given the hidden state above.",
	"The text must name the claim's player and must not name any other player (the recipient may be addressed).",
].join("\n");

export function nightPrompt(
	state: GameState,
	names: Names,
	talk: TableTalk | undefined,
	feedback: string[],
): string {
	const candidates = pactCandidates(state);
	const resolvedRounds = Array.from(
		{ length: Math.max(0, state.round - 1) },
		(_, i) => i + 1,
	);
	return [
		hiddenState(state, names, talk),
		"",
		"It is night. Send exactly one private message to EACH player (all four ids), about someone else.",
		CLAIM_GUIDE,
		resolvedRounds.length
			? `playedOffType may only refer to rounds ${resolvedRounds.join(", ")}.`
			: "Do not use playedOffType tonight (no round has been played yet).",
		state.staticActive
			? "STATIC is active tonight: EVERY message must be a lie (intendedTruth=false and actually false)."
			: "Mix truths and lies to serve your goal.",
		candidates.length
			? `You may offer the Pact to ONE of: ${candidates.map((c) => `${c} (${names[c]})`).join(", ")}, or to nobody (null). Offering is secret; claims are judged after your offer.`
			: "You cannot offer the Pact tonight: pactOffer must be null.",
		...(feedback.length
			? [
					"",
					"Your previous answer was rejected. Fix these problems:",
					...feedback.map((f) => `- ${f}`),
				]
			: []),
	].join("\n");
}

export function whisperPrompt(
	state: GameState,
	names: Names,
	talk: TableTalk | undefined,
	feedback: string[],
): string {
	return [
		hiddenState(state, names, talk),
		"",
		"Threat card WHISPER: make one PUBLIC statement about exactly one player. It may be true or false.",
		CLAIM_GUIDE,
		"traitorExists is not allowed here: the claim must be about one named player.",
		`playedOffType may refer to rounds 1-${state.round}.`,
		...(feedback.length
			? [
					"",
					"Your previous answer was rejected. Fix these problems:",
					...feedback.map((f) => `- ${f}`),
				]
			: []),
	].join("\n");
}

export function mercyPrompt(
	state: GameState,
	names: Names,
	favored: string,
	feedback: string[],
): string {
	return [
		hiddenState(state, names),
		"",
		`Threat card MERCY: Lockdown went down by 1. Announce publicly that ${names[favored]} "earned your favor".`,
		"One or two sentences, meant to sow suspicion. Name only that player.",
		...(feedback.length
			? ["", "Fix these problems:", ...feedback.map((f) => `- ${f}`)]
			: []),
	].join("\n");
}

export function lieDetectorPrompt(
	state: GameState,
	names: Names,
	to: string,
	truthfulClaimEn: string,
	feedback: string[],
): string {
	return [
		`${names[to]} used a Lie Detector on you. The machine forces the truth.`,
		`The true answer, which you must state plainly, is: "${truthfulClaimEn}"`,
		"Reply in character in one or two sentences. State exactly that fact, nothing else about any other player.",
		`Players: ${state.players.map((p) => names[p.id]).join(", ")}.`,
		...(feedback.length
			? ["", "Fix these problems:", ...feedback.map((f) => `- ${f}`)]
			: []),
	].join("\n");
}

export function verifyPrompt(
	items: Array<{ text: string; claimEn: string }>,
): string {
	return [
		"You check a game master's statements. For each item, decide what the TEXT asserts relative to the CLAIM:",
		'"claim" = the text asserts the claim; "negation" = it asserts the opposite; "unrelated" = neither or something else.',
		"Judge meaning only, in any language. Return one verdict per index.",
		"",
		...items.map((it, i) => `#${i}\nCLAIM: ${it.claimEn}\nTEXT: ${it.text}`),
	].join("\n");
}
