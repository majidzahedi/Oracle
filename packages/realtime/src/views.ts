import type {
	ActionKind,
	Card,
	Claim,
	FeedEntry,
	MessageKind,
	OracleLog,
	Outcome,
	Phase,
	Role,
	ToolCard,
	ToolType,
} from "@oracle/engine";

/**
 * What clients receive. PublicGameView goes to everyone at the table; PrivateView
 * only to the owner of a seat. Neither carries roles (except your own), other
 * hands, other players' messages or truth values until the game has ended.
 */

export type SeatStatus = "waiting" | "done" | "quarantined";

export type SeatInfo = {
	/** Engine player id: "p1".."p4". */
	playerId: string;
	seat: number;
	name: string;
	isBot: boolean;
	quarantined: boolean;
	handCount: number;
	/** Progress in the current phase (ready / played / voted). */
	status: SeatStatus;
};

export type PublicMessage = {
	id: string;
	round: number;
	kind: MessageKind;
	text: string;
};

export type ChatMessage = {
	id: string;
	round: number;
	playerId: string;
	name: string;
	text: string;
	at: string;
};

export type LogView = OracleLog & { names: Record<string, string> };

export type PublicGameView = {
	gameId: string;
	code: string;
	status: "lobby" | "active" | "finished";
	version: number;
	round: number;
	phase: Phase;
	/** ISO time when the current phase times out. */
	deadline: string | null;
	lockdown: number;
	sector: number;
	lockName: string;
	targets: Partial<Record<ToolType, number>>;
	progress: Record<ToolType, number>;
	jam: number;
	deckCount: number;
	seats: SeatInfo[];
	/** Most recently revealed pile, without owners. */
	pile: ToolCard[];
	pileRound: number | null;
	feed: FeedEntry[];
	publicMessages: PublicMessage[];
	outcome: Outcome | null;
	/** Full Oracle log; only present once the game has ended. */
	log: LogView | null;
};

export type ActionResultView =
	| { round: number; action: "decoder"; target: string; message: string | null }
	| { round: number; action: "lieDetector"; claim: Claim; answer: boolean }
	| {
			round: number;
			action: "scanner";
			pileIndex: number;
			card: ToolCard;
			owner: string;
	  }
	| { round: number; action: Extract<ActionKind, "shield" | "override"> };

export type PrivateView = {
	playerId: string;
	seat: number;
	role: Role;
	hand: Card[];
	messages: PublicMessage[];
	/** Pact offer waiting for this player's answer tonight. */
	pactOffer: { round: number } | null;
	results: ActionResultView[];
	ready: boolean;
	acted: boolean;
	/** undefined = not voted this phase; null = abstain / nobody. */
	myVote: string | null | undefined;
};

export type GameView = {
	public: PublicGameView;
	/** null for spectators. */
	me: PrivateView | null;
	chat: ChatMessage[];
};
