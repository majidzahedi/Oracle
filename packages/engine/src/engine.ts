import {
	assertValidClaim,
	claimSubjects,
	EngineError,
	evaluateClaim,
	negate,
} from "./claims";
import {
	buildDeck,
	buildThreatDeck,
	EXIT_SECTOR,
	FAILED_LOCK_PENALTY,
	HAND_SIZE,
	LOCKS,
	MAX_CARDS_PER_PLAY,
	MAX_LOCKDOWN,
	PACT_FIRST_ROUND,
	PLAYER_COUNT,
	QUARANTINE_VOTES,
	THREAT_EFFECTS,
} from "./constants";
import { nextInt, seedToState, shuffle } from "./rng";
import type {
	ActionKind,
	Card,
	Claim,
	FeedEntry,
	GameConfig,
	GameState,
	Lock,
	MessageKind,
	OracleMessage,
	Outcome,
	Phase,
	PlayerState,
	ThreatKind,
	ToolCard,
	ToolType,
} from "./types";

// ---------------------------------------------------------------------------
// helpers

// State lives in Postgres and Inngest step outputs, so it must round-trip through JSON.
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function assertPhase(state: GameState, ...phases: Phase[]): void {
	if (!phases.includes(state.phase)) {
		throw new EngineError(
			"WRONG_PHASE",
			`expected ${phases.join("|")}, got ${state.phase}`,
		);
	}
}

export function getPlayer(state: GameState, id: string): PlayerState {
	const p = state.players.find((pl) => pl.id === id);
	if (!p) throw new EngineError("UNKNOWN_PLAYER", `unknown player ${id}`);
	return p;
}

export function currentLock(state: GameState): Lock {
	return LOCKS[Math.min(state.sector, EXIT_SECTOR)] as Lock;
}

/** Amount each type of the current lock needs, including Jam on the first-listed type. */
export function lockTargets(
	state: GameState,
): Partial<Record<ToolType, number>> {
	const lock = currentLock(state);
	const out: Partial<Record<ToolType, number>> = {};
	lock.requirements.forEach((r, i) => {
		out[r.type] = r.amount + (i === 0 ? state.jam : 0);
	});
	return out;
}

export function isOffType(state: GameState, type: ToolType): boolean {
	return !currentLock(state).requirements.some((r) => r.type === type);
}

function feed(state: GameState, entry: FeedEntry): void {
	state.feed.push(entry);
}

function changeLockdown(state: GameState, delta: number): void {
	const before = state.lockdown;
	state.lockdown = Math.max(0, Math.min(MAX_LOCKDOWN, state.lockdown + delta));
	feed(state, {
		round: state.round,
		kind: "lockdown",
		value: state.lockdown,
		delta: state.lockdown - before,
	});
}

function drawCard(state: GameState): Card | null {
	if (state.deck.length === 0) {
		if (state.discard.length === 0) return null;
		[state.deck, state.rng] = shuffle(state.rng, state.discard);
		state.discard = [];
	}
	return state.deck.shift() ?? null;
}

function refillHands(state: GameState): void {
	for (const p of state.players) {
		while (p.hand.length < HAND_SIZE) {
			const c = drawCard(state);
			if (!c) break;
			p.hand.push(c);
		}
	}
}

function drawThreat(state: GameState): ThreatKind {
	if (state.threatDeck.length === 0) {
		[state.threatDeck, state.rng] = shuffle(state.rng, state.threatDiscard);
		state.threatDiscard = [];
	}
	const t = state.threatDeck.shift();
	if (!t) throw new EngineError("EMPTY_THREAT_DECK");
	return t;
}

function endGame(state: GameState, outcome: Outcome): void {
	state.outcome = outcome;
	state.phase = "ended";
	feed(state, { round: state.round, kind: "gameOver", outcome });
}

// ---------------------------------------------------------------------------
// setup

export function deal(config: GameConfig): GameState {
	const ids = config.playerIds;
	if (ids.length !== PLAYER_COUNT || new Set(ids).size !== PLAYER_COUNT) {
		throw new EngineError(
			"BAD_PLAYERS",
			`need ${PLAYER_COUNT} unique player ids`,
		);
	}
	const [deck, afterDeck] = shuffle(seedToState(config.seed), buildDeck());
	const [threatDeck, rng] = shuffle(
		afterDeck,
		buildThreatDeck(config.threatCounts),
	);

	const state: GameState = {
		seed: config.seed,
		rng,
		round: 0,
		phase: "setup",
		lockdown: 0,
		sector: 0,
		progress: { power: 0, code: 0, force: 0 },
		jam: 0,
		deck,
		discard: [],
		threatDeck,
		threatDiscard: [],
		players: ids.map((id, seat) => ({
			id,
			seat,
			role: "innocent",
			quarantined: false,
			hand: [],
		})),
		currentThreat: null,
		shielded: false,
		staticActive: false,
		staticNextRound: false,
		whisperPending: false,
		actedThisRound: [],
		pactOfferedThisNight: false,
		traitorId: null,
		pactOffers: [],
		plays: [],
		messages: [],
		threats: [],
		actionUses: [],
		feed: [],
		outcome: null,
		nextId: 1,
	};
	refillHands(state);
	return state;
}

// ---------------------------------------------------------------------------
// night

/** Starts a new round: refills hands, activates Static, and secretly draws the Threat. */
export function startNight(input: GameState): GameState {
	assertPhase(input, "setup", "vote");
	const state = clone(input);
	state.round += 1;
	state.phase = "night";
	refillHands(state);
	state.staticActive = state.staticNextRound;
	state.staticNextRound = false;
	state.currentThreat = drawThreat(state);
	state.shielded = false;
	state.whisperPending = false;
	state.pactOfferedThisNight = false;
	state.actedThisRound = [];
	feed(state, { round: state.round, kind: "roundStarted" });
	return state;
}

/** Players who may receive a Pact offer tonight (empty when no offer is allowed). */
export function pactCandidates(state: GameState): string[] {
	if (state.phase !== "night" || state.round < PACT_FIRST_ROUND) return [];
	if (state.traitorId !== null || state.pactOfferedThisNight) return [];
	const refused = new Set(state.pactOffers.map((o) => o.player));
	return state.players.filter((p) => !refused.has(p.id)).map((p) => p.id);
}

export function offerPact(input: GameState, playerId: string): GameState {
	assertPhase(input, "night");
	getPlayer(input, playerId);
	if (input.round < PACT_FIRST_ROUND) throw new EngineError("PACT_TOO_EARLY");
	if (input.pactOfferedThisNight) throw new EngineError("PACT_ALREADY_OFFERED");
	if (input.traitorId !== null) throw new EngineError("TRAITOR_EXISTS");
	if (!pactCandidates(input).includes(playerId))
		throw new EngineError("PACT_ALREADY_REFUSED");
	const state = clone(input);
	state.pactOfferedThisNight = true;
	state.pactOffers.push({
		round: state.round,
		player: playerId,
		accepted: null,
	});
	return state;
}

export function applyPact(
	input: GameState,
	playerId: string,
	accept: boolean,
): GameState {
	assertPhase(input, "night");
	const state = clone(input);
	const offer = state.pactOffers.find(
		(o) =>
			o.round === state.round && o.player === playerId && o.accepted === null,
	);
	if (!offer) throw new EngineError("NO_PENDING_PACT");
	offer.accepted = accept;
	if (accept) {
		state.traitorId = playerId;
		getPlayer(state, playerId).role = "traitor";
	}
	return state;
}

export function pendingPact(state: GameState): string | null {
	return (
		state.pactOffers.find((o) => o.round === state.round && o.accepted === null)
			?.player ?? null
	);
}

// ---------------------------------------------------------------------------
// Oracle messages

export type MessageInput = {
	to: string | null;
	kind: MessageKind;
	text: string;
	claim: Claim | null;
};

/** Checks an Oracle message against the engine's rules without recording it. Returns an error code or null. */
export function validateMessage(
	state: GameState,
	msg: MessageInput,
): string | null {
	try {
		if (msg.claim) assertValidClaim(state, msg.claim);
		if (msg.to !== null) getPlayer(state, msg.to);
	} catch (e) {
		return e instanceof EngineError ? e.code : "BAD_MESSAGE";
	}
	switch (msg.kind) {
		case "night": {
			if (state.phase !== "night") return "WRONG_PHASE";
			if (msg.to === null) return "NIGHT_MESSAGE_NEEDS_RECIPIENT";
			if (!msg.claim) return "CLAIM_REQUIRED";
			if (claimSubjects(msg.claim).includes(msg.to))
				return "NIGHT_MESSAGE_ABOUT_SELF";
			const already = state.messages.some(
				(m) => m.kind === "night" && m.round === state.round && m.to === msg.to,
			);
			if (already) return "NIGHT_MESSAGE_ALREADY_SENT";
			if (state.staticActive && evaluateClaim(state, msg.claim))
				return "STATIC_REQUIRES_LIE";
			return null;
		}
		case "whisper": {
			if (!state.whisperPending) return "NO_WHISPER_PENDING";
			if (msg.to !== null) return "WHISPER_IS_PUBLIC";
			if (!msg.claim || claimSubjects(msg.claim).length !== 1)
				return "WHISPER_NEEDS_ONE_PLAYER";
			return null;
		}
		case "lieDetector": {
			if (msg.to === null || !msg.claim) return "CLAIM_REQUIRED";
			// The Oracle may never lie here: the stated claim must be true.
			if (!evaluateClaim(state, msg.claim)) return "LIE_DETECTOR_MUST_BE_TRUE";
			return null;
		}
		case "mercy":
		case "announcement":
			return null;
	}
}

/** Records an Oracle message with its real truth value. Throws if the message breaks a rule. */
export function recordMessage(
	input: GameState,
	msg: MessageInput,
): { state: GameState; message: OracleMessage } {
	const err = validateMessage(input, msg);
	if (err) throw new EngineError(err);
	const state = clone(input);
	const message: OracleMessage = {
		id: `m${state.nextId++}`,
		round: state.round,
		to: msg.to,
		kind: msg.kind,
		text: msg.text,
		claim: msg.claim,
		truth: msg.claim ? evaluateClaim(state, msg.claim) : null,
	};
	state.messages.push(message);
	if (msg.kind === "whisper") state.whisperPending = false;
	return { state, message };
}

// ---------------------------------------------------------------------------
// day

/** Night -> Day. An unanswered Pact offer counts as refused. */
export function startDay(input: GameState): GameState {
	assertPhase(input, "night");
	const state = clone(input);
	for (const o of state.pactOffers) if (o.accepted === null) o.accepted = false;
	state.phase = "day";
	return state;
}

export type ActionInput =
	| { action: "decoder"; target: string }
	| { action: "lieDetector"; claim: Claim }
	| { action: "shield" }
	| { action: "override" }
	| { action: "scanner"; pileIndex: number };

export type ActionResult =
	| { action: "decoder"; target: string; message: string | null }
	| {
			action: "lieDetector";
			claim: Claim;
			answer: boolean;
			truthfulClaim: Claim;
	  }
	| { action: "shield" }
	| { action: "override"; lockdown: number }
	| { action: "scanner"; pileIndex: number; card: ToolCard; owner: string };

const ACTION_PHASE: Record<ActionKind, Phase> = {
	decoder: "day",
	lieDetector: "day",
	shield: "day",
	override: "day",
	scanner: "vote", // after the pile is revealed
};

export function useAction(
	input: GameState,
	playerId: string,
	act: ActionInput,
): { state: GameState; result: ActionResult } {
	assertPhase(input, ACTION_PHASE[act.action]);
	const state = clone(input);
	const player = getPlayer(state, playerId);
	const idx = player.hand.findIndex(
		(c) => c.kind === "action" && c.action === act.action,
	);
	if (idx < 0)
		throw new EngineError(
			"CARD_NOT_IN_HAND",
			`${playerId} has no ${act.action}`,
		);

	let result: ActionResult;
	switch (act.action) {
		case "decoder": {
			getPlayer(state, act.target);
			if (act.target === playerId) throw new EngineError("DECODER_SELF");
			const msg = state.messages.find(
				(m) =>
					m.kind === "night" && m.round === state.round && m.to === act.target,
			);
			result = {
				action: "decoder",
				target: act.target,
				message: msg?.text ?? null,
			};
			state.actionUses.push({
				round: state.round,
				player: playerId,
				action: "decoder",
				target: act.target,
			});
			break;
		}
		case "lieDetector": {
			// The engine computes the answer; the Oracle only decorates it.
			const answer = evaluateClaim(state, act.claim);
			result = {
				action: "lieDetector",
				claim: act.claim,
				answer,
				truthfulClaim: answer ? act.claim : negate(act.claim),
			};
			state.actionUses.push({
				round: state.round,
				player: playerId,
				action: "lieDetector",
				claim: act.claim,
				answer,
			});
			break;
		}
		case "shield":
			state.shielded = true;
			result = { action: "shield" };
			state.actionUses.push({
				round: state.round,
				player: playerId,
				action: "shield",
			});
			break;
		case "override":
			changeLockdown(state, THREAT_EFFECTS.overrideLockdown);
			result = { action: "override", lockdown: state.lockdown };
			state.actionUses.push({
				round: state.round,
				player: playerId,
				action: "override",
			});
			break;
		case "scanner": {
			const play = state.plays.find(
				(p) => p.round === state.round && p.pileIndex === act.pileIndex,
			);
			if (!play) throw new EngineError("BAD_PILE_INDEX");
			result = {
				action: "scanner",
				pileIndex: act.pileIndex,
				card: play.card,
				owner: play.owner,
			};
			state.actionUses.push({
				round: state.round,
				player: playerId,
				action: "scanner",
				pileIndex: act.pileIndex,
			});
			break;
		}
	}
	const [card] = player.hand.splice(idx, 1);
	state.discard.push(card as Card);
	feed(state, {
		round: state.round,
		kind: "actionUsed",
		player: playerId,
		action: act.action,
	});
	return { state, result };
}

// ---------------------------------------------------------------------------
// action phase

export function startAction(input: GameState): GameState {
	assertPhase(input, "day");
	const state = clone(input);
	state.phase = "action";
	state.actedThisRound = [];
	return state;
}

/** Non-quarantined players: the ones expected to play this Action phase. */
export function activePlayers(state: GameState): string[] {
	return state.players.filter((p) => !p.quarantined).map((p) => p.id);
}

export function allActed(state: GameState): boolean {
	return activePlayers(state).every((id) => state.actedThisRound.includes(id));
}

function hasToolCard(p: PlayerState): boolean {
	return p.hand.some((c) => c.kind === "tool");
}

export function playCards(
	input: GameState,
	playerId: string,
	cardIds: string[],
	opts: { auto?: boolean } = {},
): GameState {
	assertPhase(input, "action");
	const state = clone(input);
	const player = getPlayer(state, playerId);
	if (player.quarantined) throw new EngineError("QUARANTINED");
	if (state.actedThisRound.includes(playerId))
		throw new EngineError("ALREADY_PLAYED");
	if (new Set(cardIds).size !== cardIds.length)
		throw new EngineError("DUPLICATE_CARD");
	const minCards = hasToolCard(player) ? 1 : 0;
	if (cardIds.length < minCards || cardIds.length > MAX_CARDS_PER_PLAY) {
		throw new EngineError(
			"BAD_CARD_COUNT",
			`play ${minCards}-${MAX_CARDS_PER_PLAY} tool cards`,
		);
	}
	for (const id of cardIds) {
		const idx = player.hand.findIndex((c) => c.id === id);
		const card = player.hand[idx];
		if (!card) throw new EngineError("CARD_NOT_IN_HAND", id);
		if (card.kind !== "tool") throw new EngineError("NOT_A_TOOL_CARD", id);
		player.hand.splice(idx, 1);
		state.plays.push({
			round: state.round,
			owner: playerId,
			card,
			offType: isOffType(state, card.type),
			pileIndex: null,
			auto: opts.auto ?? false,
		});
	}
	state.actedThisRound.push(playerId);
	feed(state, {
		round: state.round,
		kind: "cardsPlayed",
		player: playerId,
		count: cardIds.length,
	});
	return state;
}

/** The card an idle player auto-plays: the highest matching card for the neediest type, or none. */
export function autoPlayChoice(state: GameState, playerId: string): string[] {
	const player = getPlayer(state, playerId);
	const targets = lockTargets(state);
	const need = (t: ToolType) => (targets[t] ?? 0) - state.progress[t];
	const matching = player.hand
		.filter(
			(c): c is ToolCard => c.kind === "tool" && !isOffType(state, c.type),
		)
		.sort((a, b) => need(b.type) - need(a.type) || b.value - a.value);
	return matching[0] ? [matching[0].id] : [];
}

/** Timeout handling: every active player who has not acted plays their auto choice (possibly nothing). */
export function autoPlayIdle(input: GameState): GameState {
	assertPhase(input, "action");
	let state = input;
	for (const id of activePlayers(input)) {
		if (state.actedThisRound.includes(id)) continue;
		const choice = autoPlayChoice(state, id);
		if (choice.length > 0) {
			state = playCards(state, id, choice, { auto: true });
		} else {
			state = clone(state);
			state.actedThisRound.push(id);
			feed(state, {
				round: state.round,
				kind: "cardsPlayed",
				player: id,
				count: 0,
			});
		}
	}
	return state;
}

// ---------------------------------------------------------------------------
// resolution

/**
 * Reveals the shuffled pile, applies cards to the lock, then the Threat.
 * Ends in "vote", "final" (exit opened) or "ended" (Lockdown 12).
 */
export function resolveRound(input: GameState): GameState {
	assertPhase(input, "action");
	const state = clone(allActed(input) ? input : autoPlayIdle(input));
	const roundPlays = state.plays.filter((p) => p.round === state.round);

	// Shuffle the pile so owners are hidden, then reveal.
	let order: number[];
	[order, state.rng] = shuffle(
		state.rng,
		roundPlays.map((_, i) => i),
	);
	order.forEach((playIdx, pileIdx) => {
		(roundPlays[playIdx] as (typeof roundPlays)[number]).pileIndex = pileIdx;
	});
	const pile = [...roundPlays]
		.sort((a, b) => (a.pileIndex ?? 0) - (b.pileIndex ?? 0))
		.map((p) => p.card);
	feed(state, { round: state.round, kind: "pileRevealed", pile });

	// Matching cards add; off-type cards subtract from the first-listed type (min 0).
	const lock = currentLock(state);
	const firstType = (lock.requirements[0] as { type: ToolType }).type;
	let offTotal = 0;
	for (const p of roundPlays) {
		if (p.offType) offTotal += p.card.value;
		else state.progress[p.card.type] += p.card.value;
	}
	state.progress[firstType] = Math.max(0, state.progress[firstType] - offTotal);

	const targets = lockTargets(state);
	const opened = lock.requirements.every(
		(r) => state.progress[r.type] >= (targets[r.type] ?? 0),
	);
	feed(state, {
		round: state.round,
		kind: "lockResolved",
		sector: state.sector,
		opened,
		progress: { ...state.progress },
	});
	for (const p of roundPlays) state.discard.push(p.card);

	const exitOpened = opened && state.sector === EXIT_SECTOR;
	if (opened) {
		state.sector += 1;
		state.progress = { power: 0, code: 0, force: 0 };
		state.jam = 0;
	} else {
		changeLockdown(state, FAILED_LOCK_PENALTY);
	}

	// Quarantine lasts exactly one Action phase.
	for (const p of state.players) p.quarantined = false;

	applyThreatInPlace(state);

	if (state.lockdown >= MAX_LOCKDOWN) {
		endGame(state, {
			kind: "sealed",
			winners: state.traitorId ? ["oracle", "traitor"] : ["oracle"],
		});
	} else {
		state.phase = exitOpened ? "final" : "vote";
	}
	return state;
}

function applyThreatInPlace(state: GameState): void {
	const threat = state.currentThreat;
	if (!threat) return;
	state.currentThreat = null;
	state.threatDiscard.push(threat);
	if (state.shielded) {
		state.threats.push({ round: state.round, threat, shielded: true });
		feed(state, { round: state.round, kind: "threat", announced: "shielded" });
		return;
	}
	const record: GameState["threats"][number] = {
		round: state.round,
		threat,
		shielded: false,
	};
	switch (threat) {
		case "powerSurge":
			changeLockdown(state, THREAT_EFFECTS.powerSurgeLockdown);
			feed(state, {
				round: state.round,
				kind: "threat",
				announced: "powerSurge",
			});
			break;
		case "whisper":
			state.whisperPending = true;
			feed(state, { round: state.round, kind: "threat", announced: "whisper" });
			break;
		case "jam":
			state.jam += THREAT_EFFECTS.jamAmount;
			feed(state, { round: state.round, kind: "threat", announced: "jam" });
			break;
		case "mercy": {
			let i: number;
			[i, state.rng] = nextInt(state.rng, state.players.length);
			record.favoredPlayer = (state.players[i] as PlayerState).id;
			changeLockdown(state, THREAT_EFFECTS.mercyLockdown);
			feed(state, { round: state.round, kind: "threat", announced: "mercy" });
			break;
		}
		case "static":
			// Announced as "no threat"; next night every message must be a lie.
			state.staticNextRound = true;
			feed(state, { round: state.round, kind: "threat", announced: "none" });
			break;
	}
	state.threats.push(record);
}

/** Applies this round's Threat card exactly as written (resolveRound calls this). */
export function applyThreat(input: GameState): GameState {
	const state = clone(input);
	applyThreatInPlace(state);
	if (state.lockdown >= MAX_LOCKDOWN && state.phase !== "ended") {
		endGame(state, {
			kind: "sealed",
			winners: state.traitorId ? ["oracle", "traitor"] : ["oracle"],
		});
	}
	return state;
}

/** Mercy: the player the Oracle must name this round, if any. */
export function favoredPlayer(state: GameState): string | null {
	const t = state.threats.find(
		(r) => r.round === state.round && r.threat === "mercy",
	);
	return t?.favoredPlayer ?? null;
}

// ---------------------------------------------------------------------------
// vote

/**
 * votes: voter -> target (null = abstain). A player with at least 3 votes is
 * quarantined for the next Action phase. Quarantined players may vote; nobody may vote for themselves.
 */
export function applyVotes(
	input: GameState,
	votes: Record<string, string | null>,
): GameState {
	assertPhase(input, "vote");
	const state = clone(input);
	const tally = new Map<string, number>();
	for (const [voter, target] of Object.entries(votes)) {
		getPlayer(state, voter);
		if (target === null) continue;
		getPlayer(state, target);
		if (voter === target) throw new EngineError("SELF_VOTE");
		tally.set(target, (tally.get(target) ?? 0) + 1);
	}
	let quarantined: string | null = null;
	for (const [target, count] of tally) {
		if (count >= QUARANTINE_VOTES) {
			getPlayer(state, target).quarantined = true;
			quarantined = target;
		}
	}
	feed(state, { round: state.round, kind: "quarantine", player: quarantined });
	return state;
}

// ---------------------------------------------------------------------------
// end of game

export function finalChoice(
	input: GameState,
	leftBehind: string | null,
): GameState {
	assertPhase(input, "final");
	const state = clone(input);
	if (leftBehind !== null) getPlayer(state, leftBehind);
	const traitor = state.traitorId;
	let outcome: Outcome;
	if (traitor && leftBehind === traitor) {
		outcome = {
			kind: "escaped",
			escape: "perfect",
			leftBehind,
			traitorEscaped: false,
			winners: ["players"],
		};
	} else if (traitor) {
		outcome = {
			kind: "escaped",
			escape: leftBehind ? "bitter" : "betrayed",
			leftBehind,
			traitorEscaped: true,
			winners: ["traitor"],
		};
	} else {
		outcome = {
			kind: "escaped",
			escape: leftBehind ? "bitter" : "clean",
			leftBehind,
			traitorEscaped: false,
			winners: ["players"],
		};
	}
	endGame(state, outcome);
	return state;
}
