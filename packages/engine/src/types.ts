export const TOOL_TYPES = ["power", "code", "force"] as const;
export type ToolType = (typeof TOOL_TYPES)[number];

export const ACTION_KINDS = [
	"decoder",
	"lieDetector",
	"shield",
	"override",
	"scanner",
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const THREAT_KINDS = [
	"powerSurge",
	"whisper",
	"jam",
	"mercy",
	"static",
] as const;
export type ThreatKind = (typeof THREAT_KINDS)[number];

export type ToolCard = {
	id: string;
	kind: "tool";
	type: ToolType;
	value: number;
};
export type ActionCard = { id: string; kind: "action"; action: ActionKind };
export type Card = ToolCard | ActionCard;

export type Role = "innocent" | "traitor";

export type Phase =
	| "setup"
	| "night"
	| "day"
	| "action"
	| "vote"
	| "final" // exit is open, players choose who to leave behind
	| "ended";

/** One lock requirement, in printed order. The first entry is the "first-listed type". */
export type LockRequirement = { type: ToolType; amount: number };
export type Lock = { name: string; requirements: LockRequirement[] };

export type PlayerState = {
	id: string;
	seat: number;
	role: Role;
	/** Skips the next Action phase. Cleared once that Action phase is resolved. */
	quarantined: boolean;
	hand: Card[];
};

/** Machine-checkable statement. Every Oracle message and Lie Detector question carries one. */
export type Claim =
	| { type: "isTraitor"; player: string }
	| { type: "playedOffType"; player: string; round: number }
	| { type: "receivedPact"; player: string }
	| { type: "noTraitorYet" }
	| { type: "traitorExists" }
	| { type: "not"; claim: Claim };

export type MessageKind =
	| "night"
	| "whisper"
	| "mercy"
	| "lieDetector"
	| "announcement";

export type OracleMessage = {
	id: string;
	round: number;
	/** null = public */
	to: string | null;
	kind: MessageKind;
	text: string;
	claim: Claim | null;
	/** Real truth value, computed by the engine. null when the message makes no claim. */
	truth: boolean | null;
};

export type PactOffer = {
	round: number;
	player: string;
	/** null while unanswered */
	accepted: boolean | null;
};

export type Play = {
	round: number;
	owner: string;
	card: ToolCard;
	offType: boolean;
	/** Position in the revealed (shuffled) pile, set at reveal. */
	pileIndex: number | null;
	auto: boolean;
};

export type ThreatRecord = {
	round: number;
	threat: ThreatKind;
	shielded: boolean;
	/** Mercy: the player the Oracle names as "earning its favor". */
	favoredPlayer?: string;
};

export type ActionUse = {
	round: number;
	player: string;
	action: ActionKind;
	target?: string;
	claim?: Claim;
	pileIndex?: number;
	answer?: boolean;
};

export type FeedEntry =
	| { round: number; kind: "roundStarted" }
	| { round: number; kind: "actionUsed"; player: string; action: ActionKind }
	| { round: number; kind: "cardsPlayed"; player: string; count: number }
	| { round: number; kind: "pileRevealed"; pile: ToolCard[] }
	| {
			round: number;
			kind: "lockResolved";
			sector: number;
			opened: boolean;
			progress: Record<ToolType, number>;
	  }
	| {
			round: number;
			kind: "threat";
			announced: ThreatKind | "none" | "shielded";
	  }
	| { round: number; kind: "lockdown"; value: number; delta: number }
	| { round: number; kind: "quarantine"; player: string | null }
	| { round: number; kind: "gameOver"; outcome: Outcome };

/** betrayed = a traitor existed and nobody was left behind. */
export type EscapeKind = "perfect" | "clean" | "bitter" | "betrayed";

export type Outcome =
	| { kind: "sealed"; winners: Array<"oracle" | "traitor"> }
	| {
			kind: "escaped";
			escape: EscapeKind;
			leftBehind: string | null;
			/** True when a traitor existed and walked out unidentified. */
			traitorEscaped: boolean;
			winners: Array<"players" | "traitor">;
	  };

export type GameConfig = {
	seed: string;
	playerIds: string[];
	/** Threat deck composition; defaults to 2 of each threat. */
	threatCounts?: Partial<Record<ThreatKind, number>>;
};

export type GameState = {
	seed: string;
	/** Current RNG state (mulberry32). Advanced by every random operation. */
	rng: number;
	round: number;
	phase: Phase;
	lockdown: number;
	/** Index into LOCKS; 3 = exit. */
	sector: number;
	progress: Record<ToolType, number>;
	/** Extra amount the current lock's first-listed type needs. Reset when the lock opens. */
	jam: number;
	deck: Card[];
	discard: Card[];
	threatDeck: ThreatKind[];
	threatDiscard: ThreatKind[];
	players: PlayerState[];
	/** Threat drawn this night; secret until resolution. */
	currentThreat: ThreatKind | null;
	shielded: boolean;
	/** Static was applied last round: every night message this round must be false. */
	staticActive: boolean;
	staticNextRound: boolean;
	/** Whisper drawn: the Oracle owes a public statement about one player this round. */
	whisperPending: boolean;
	/** Players who already played cards this Action phase. */
	actedThisRound: string[];
	/** Pact offer made this night, if any. */
	pactOfferedThisNight: boolean;
	traitorId: string | null;
	pactOffers: PactOffer[];
	plays: Play[];
	messages: OracleMessage[];
	threats: ThreatRecord[];
	actionUses: ActionUse[];
	feed: FeedEntry[];
	outcome: Outcome | null;
	nextId: number;
};
