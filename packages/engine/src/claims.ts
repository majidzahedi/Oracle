import type { Claim, GameState } from "./types";

export class EngineError extends Error {
	constructor(
		readonly code: string,
		message?: string,
	) {
		super(message ? `${code}: ${message}` : code);
		this.name = "EngineError";
	}
}

/** True once that round's pile has been revealed. */
export function isRoundResolved(state: GameState, round: number): boolean {
	if (round < state.round) return true;
	return (
		round === state.round && ["vote", "final", "ended"].includes(state.phase)
	);
}

/** Players a claim talks about. */
export function claimSubjects(claim: Claim): string[] {
	switch (claim.type) {
		case "isTraitor":
		case "playedOffType":
		case "receivedPact":
			return [claim.player];
		case "noTraitorYet":
		case "traitorExists":
			return [];
		case "not":
			return claimSubjects(claim.claim);
	}
}

export function assertValidClaim(state: GameState, claim: Claim): void {
	for (const p of claimSubjects(claim)) {
		if (!state.players.some((pl) => pl.id === p)) {
			throw new EngineError(
				"UNKNOWN_PLAYER",
				`claim refers to unknown player ${p}`,
			);
		}
	}
	if (
		claim.type === "playedOffType" &&
		(!Number.isInteger(claim.round) || claim.round < 1)
	) {
		throw new EngineError("BAD_CLAIM", "playedOffType needs a round >= 1");
	}
	if (claim.type === "playedOffType" && !isRoundResolved(state, claim.round)) {
		// Otherwise a claim's truth would flip after it was logged.
		throw new EngineError(
			"CLAIM_ABOUT_UNPLAYED_ROUND",
			`round ${claim.round} not resolved yet`,
		);
	}
	if (claim.type === "not") assertValidClaim(state, claim.claim);
}

/** Evaluates a claim against the real hidden state. This is the only source of truth values. */
export function evaluateClaim(state: GameState, claim: Claim): boolean {
	assertValidClaim(state, claim);
	switch (claim.type) {
		case "isTraitor":
			return state.traitorId === claim.player;
		case "playedOffType":
			return state.plays.some(
				(p) => p.owner === claim.player && p.round === claim.round && p.offType,
			);
		case "receivedPact":
			return state.pactOffers.some((o) => o.player === claim.player);
		case "noTraitorYet":
			return state.traitorId === null;
		case "traitorExists":
			return state.traitorId !== null;
		case "not":
			return !evaluateClaim(state, claim.claim);
	}
}

export function negate(claim: Claim): Claim {
	return claim.type === "not" ? claim.claim : { type: "not", claim };
}
