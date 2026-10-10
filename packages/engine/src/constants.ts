import {
	ACTION_KINDS,
	type Card,
	type Lock,
	THREAT_KINDS,
	type ThreatKind,
	TOOL_TYPES,
} from "./types";

export const PLAYER_COUNT = 4;
export const HAND_SIZE = 5;
export const MAX_LOCKDOWN = 12;
export const FAILED_LOCK_PENALTY = 2;
export const QUARANTINE_VOTES = 3;
export const PACT_FIRST_ROUND = 2;
export const MAX_CARDS_PER_PLAY = 2;

export const LOCKS: readonly Lock[] = [
	{
		name: "generator",
		requirements: [
			{ type: "power", amount: 8 },
			{ type: "code", amount: 4 },
		],
	},
	{
		name: "securityTerminal",
		requirements: [
			{ type: "code", amount: 7 },
			{ type: "force", amount: 6 },
		],
	},
	{
		name: "pressureGate",
		requirements: [
			{ type: "power", amount: 6 },
			{ type: "force", amount: 6 },
		],
	},
	{
		name: "exit",
		requirements: [
			{ type: "power", amount: 5 },
			{ type: "code", amount: 5 },
			{ type: "force", amount: 5 },
		],
	},
];
export const EXIT_SECTOR = LOCKS.length - 1;

export const THREAT_EFFECTS = {
	powerSurgeLockdown: 2,
	jamAmount: 3,
	mercyLockdown: -1,
	overrideLockdown: -2,
} as const;

/** 45 tool cards (3 types × values 1–5 × 3 copies) + 15 action cards (3 of each). */
export function buildDeck(): Card[] {
	const cards: Card[] = [];
	for (const type of TOOL_TYPES) {
		for (let value = 1; value <= 5; value++) {
			for (let copy = 0; copy < 3; copy++) {
				cards.push({
					id: `${type}-${value}-${copy}`,
					kind: "tool",
					type,
					value,
				});
			}
		}
	}
	for (const action of ACTION_KINDS) {
		for (let copy = 0; copy < 3; copy++) {
			cards.push({ id: `${action}-${copy}`, kind: "action", action });
		}
	}
	return cards;
}

export const DEFAULT_THREAT_COUNT = 2;

export function buildThreatDeck(
	counts: Partial<Record<ThreatKind, number>> = {},
): ThreatKind[] {
	return THREAT_KINDS.flatMap((t) =>
		Array.from({ length: counts[t] ?? DEFAULT_THREAT_COUNT }, () => t),
	);
}
