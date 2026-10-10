import { EngineError } from "./claims";
import { LOCKS } from "./constants";
import { lockTargets } from "./engine";
import type {
	ActionUse,
	Card,
	Claim,
	FeedEntry,
	GameState,
	MessageKind,
	Outcome,
	PactOffer,
	Phase,
	Play,
	Role,
	ThreatRecord,
	ToolCard,
	ToolType,
} from "./types";

/** What everyone at the table may see. Never contains roles, hands, private messages or truth values. */
export type PublicView = {
	round: number;
	phase: Phase;
	lockdown: number;
	sector: number;
	lockName: string;
	targets: Partial<Record<ToolType, number>>;
	progress: Record<ToolType, number>;
	jam: number;
	deckCount: number;
	players: Array<{
		id: string;
		seat: number;
		quarantined: boolean;
		handCount: number;
		acted: boolean;
	}>;
	/** Most recently revealed pile, without owners. */
	pile: ToolCard[];
	publicMessages: Array<{
		id: string;
		round: number;
		kind: MessageKind;
		text: string;
	}>;
	feed: FeedEntry[];
	outcome: Outcome | null;
};

export type PrivateView = PublicView & {
	me: {
		id: string;
		role: Role;
		hand: Card[];
		messages: Array<{
			id: string;
			round: number;
			kind: MessageKind;
			text: string;
		}>;
		pactOffer: { round: number; answered: boolean } | null;
	};
};

export function publicView(state: GameState): PublicView {
	const lastPile = [...state.feed]
		.reverse()
		.find((f) => f.kind === "pileRevealed");
	return {
		round: state.round,
		phase: state.phase,
		lockdown: state.lockdown,
		sector: state.sector,
		lockName: (
			LOCKS[Math.min(state.sector, LOCKS.length - 1)] as { name: string }
		).name,
		targets: lockTargets(state),
		progress: { ...state.progress },
		jam: state.jam,
		deckCount: state.deck.length,
		players: state.players.map((p) => ({
			id: p.id,
			seat: p.seat,
			quarantined: p.quarantined,
			handCount: p.hand.length,
			acted: state.actedThisRound.includes(p.id),
		})),
		pile: lastPile && lastPile.kind === "pileRevealed" ? lastPile.pile : [],
		publicMessages: state.messages
			.filter((m) => m.to === null)
			.map(({ id, round, kind, text }) => ({ id, round, kind, text })),
		feed: state.feed,
		outcome: state.outcome,
	};
}

export function playerView(state: GameState, playerId: string): PrivateView {
	const me = state.players.find((p) => p.id === playerId);
	if (!me) throw new EngineError("UNKNOWN_PLAYER");
	const offer = [...state.pactOffers]
		.reverse()
		.find((o) => o.player === playerId);
	return {
		...publicView(state),
		me: {
			id: me.id,
			role: me.role,
			hand: me.hand,
			messages: state.messages
				.filter((m) => m.to === playerId)
				.map(({ id, round, kind, text }) => ({ id, round, kind, text })),
			pactOffer:
				offer && offer.round === state.round && offer.accepted === null
					? { round: offer.round, answered: false }
					: null,
		},
	};
}

export type OracleLog = {
	seed: string;
	traitor: string | null;
	roles: Record<string, Role>;
	messages: Array<{
		id: string;
		round: number;
		to: string | null;
		kind: MessageKind;
		text: string;
		claim: Claim | null;
		truth: boolean | null;
	}>;
	pactOffers: PactOffer[];
	threats: ThreatRecord[];
	plays: Play[];
	offTypePlays: Play[];
	actionUses: ActionUse[];
	outcome: Outcome;
};

/** The Oracle's full log. Only available once the game has ended. */
export function revealLog(state: GameState): OracleLog {
	if (state.phase !== "ended" || !state.outcome)
		throw new EngineError("GAME_NOT_OVER");
	return {
		seed: state.seed,
		traitor: state.traitorId,
		roles: Object.fromEntries(state.players.map((p) => [p.id, p.role])),
		messages: state.messages,
		pactOffers: state.pactOffers,
		threats: state.threats,
		plays: state.plays,
		offTypePlays: state.plays.filter((p) => p.offType),
		actionUses: state.actionUses,
		outcome: state.outcome,
	};
}
