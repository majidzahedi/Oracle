import {
	applyPact,
	applyVotes,
	deal,
	finalChoice,
	type GameState,
	offerPact,
	pactCandidates,
	playCards,
	playerView,
	publicView,
	recordMessage,
	resolveRound,
	startAction,
	startDay,
	startNight,
	useAction,
} from "@oracle/engine";
import { scriptedNightMessages } from "@oracle/oracle";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";

import {
	type BotCtx,
	type BotView,
	describeView,
	heuristicAction,
	heuristicDay,
	heuristicFinal,
	heuristicNight,
	heuristicVote,
	planAction,
	planDay,
	suspicion,
	topSuspect,
} from "../src";

const NAMES: Record<string, string> = {
	p1: "Ana",
	p2: "Bita",
	p3: "Cyrus",
	p4: "Dara",
};
const IDS = ["p1", "p2", "p3", "p4"];

/** Builds the same view a client gets (public + private + chat), from engine projections only. */
function viewFor(s: GameState, pid: string, gameId = "g1"): BotView {
	const pub = publicView(s);
	const me = playerView(s, pid).me;
	const lastPile = [...s.feed].reverse().find((f) => f.kind === "pileRevealed");
	return {
		public: {
			gameId,
			code: "ABCDE",
			status: s.phase === "ended" ? "finished" : "active",
			version: 1,
			round: pub.round,
			phase: pub.phase,
			deadline: null,
			lockdown: pub.lockdown,
			sector: pub.sector,
			lockName: pub.lockName,
			targets: pub.targets,
			progress: pub.progress,
			jam: pub.jam,
			deckCount: pub.deckCount,
			seats: pub.players.map((p) => ({
				playerId: p.id,
				seat: p.seat,
				name: NAMES[p.id] ?? p.id,
				isBot: true,
				quarantined: p.quarantined,
				handCount: p.handCount,
				status: "waiting",
				away: false,
			})),
			pile: pub.pile,
			pileRound: lastPile?.round ?? null,
			feed: pub.feed,
			publicMessages: pub.publicMessages,
			outcome: pub.outcome,
			log: null,
		},
		me: {
			playerId: pid,
			seat: me.id ? Number(pid.slice(1)) - 1 : 0,
			role: me.role,
			hand: me.hand,
			messages: me.messages,
			pactOffer: me.pactOffer ? { round: me.pactOffer.round } : null,
			results: s.actionUses
				.filter(
					(u) => u.player === pid && u.action === "lieDetector" && u.claim,
				)
				.map((u) => ({
					round: u.round,
					action: "lieDetector" as const,
					claim: u.claim as never,
					answer: u.answer ?? false,
				})),
			ready: false,
			acted: s.actedThisRound.includes(pid),
			myVote: undefined,
		},
		chat: [],
	};
}

function mockModel(answers: unknown[]) {
	let i = 0;
	return new MockLanguageModelV4({
		doGenerate: async () => {
			const a = answers[Math.min(i++, answers.length - 1)];
			if (a instanceof Error) throw a;
			return {
				content: [{ type: "text", text: JSON.stringify(a) }],
				finishReason: { unified: "stop", raw: undefined },
				usage: {
					inputTokens: {
						total: 1,
						noCache: 1,
						cacheRead: undefined,
						cacheWrite: undefined,
					},
					outputTokens: { total: 1, text: 1, reasoning: undefined },
				},
				warnings: [],
			};
		},
	});
}
const llm = (answers: unknown[]): BotCtx => ({
	model: mockModel(answers),
	profile: { temperature: 0.7, timeoutMs: 5000 },
	lang: "en",
});

/** Plays a whole game where all four seats are heuristic bots acting only on their views. */
function botGame(seed: string): GameState {
	let s = deal({ seed, playerIds: IDS });
	for (let round = 1; round <= 40 && s.phase !== "ended"; round++) {
		s = startNight(s);
		const cands = pactCandidates(s);
		if (cands.length) s = offerPact(s, cands[round % cands.length] as string);
		for (const m of scriptedNightMessages(s, NAMES, "en"))
			s = recordMessage(s, m).state;
		for (const p of IDS) {
			const plan = heuristicNight(viewFor(s, p, seed));
			if (plan.acceptPact !== null) s = applyPact(s, p, plan.acceptPact);
		}
		s = startDay(s);
		for (const p of IDS) {
			const plan = heuristicDay(viewFor(s, p, seed), "en");
			expect(plan.chat.length).toBeGreaterThan(0);
			if (plan.action) s = useAction(s, p, plan.action).state;
		}
		s = startAction(s);
		for (const p of IDS) {
			if (s.players.find((x) => x.id === p)?.quarantined) continue;
			s = playCards(s, p, heuristicAction(viewFor(s, p, seed)).cardIds);
		}
		s = resolveRound(s);
		if (s.phase === "ended") break;
		if (s.phase === "final") {
			const votes = Object.fromEntries(
				IDS.map((p) => [p, heuristicFinal(viewFor(s, p, seed)).target]),
			);
			const counts = new Map<string, number>();
			for (const t of Object.values(votes))
				if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
			const left = [...counts].find(([, n]) => n >= 3)?.[0] ?? null;
			s = finalChoice(s, left);
			break;
		}
		const votes: Record<string, string | null> = {};
		for (const p of IDS) {
			const plan = heuristicVote(viewFor(s, p, seed), "en");
			votes[p] = plan.target;
			if (plan.scanPileIndex !== null)
				s = useAction(s, p, {
					action: "scanner",
					pileIndex: plan.scanPileIndex,
				}).state;
		}
		s = applyVotes(s, votes);
	}
	return s;
}

describe("heuristic bots", () => {
	it("play 60 full games with only legal moves, decided from their own views", () => {
		const outcomes = new Set<string>();
		let traitorBots = 0;
		for (let i = 0; i < 60; i++) {
			const s = botGame(`bots-${i}`);
			expect(s.phase).toBe("ended");
			const o = s.outcome;
			outcomes.add(o?.kind === "escaped" ? o.escape : "sealed");
			if (s.traitorId) traitorBots++;
		}
		expect(outcomes.size).toBeGreaterThan(1);
		expect(traitorBots).toBeGreaterThan(0);
	});

	it("an innocent bot plays its best matching cards", () => {
		let s = startAction(
			startDay(startNight(deal({ seed: "inn", playerIds: IDS }))),
		);
		const p = s.players[0];
		if (!p) throw new Error();
		p.hand = [
			{ id: "power-5-0", kind: "tool", type: "power", value: 5 },
			{ id: "power-2-0", kind: "tool", type: "power", value: 2 },
			{ id: "code-4-0", kind: "tool", type: "code", value: 4 },
			{ id: "force-5-0", kind: "tool", type: "force", value: 5 },
		];
		s = { ...s };
		const ids = heuristicAction(viewFor(s, "p1")).cardIds;
		expect(ids).toHaveLength(2);
		expect(ids).not.toContain("force-5-0"); // force is off-type at the Generator
		expect(ids).toContain("power-5-0");
	});

	it("a traitor bot sabotages in some rounds and not in others", () => {
		const choices = new Set<boolean>();
		for (let i = 0; i < 30; i++) {
			const s = startAction(
				startDay(startNight(deal({ seed: `t-${i}`, playerIds: IDS }))),
			);
			const p = s.players[0];
			if (!p) throw new Error();
			p.role = "traitor";
			p.hand = [
				{ id: "power-3-0", kind: "tool", type: "power", value: 3 },
				{ id: "force-4-0", kind: "tool", type: "force", value: 4 },
			];
			choices.add(
				heuristicAction(
					viewFor({ ...s, traitorId: "p1" }, "p1", `g${i}`),
				).cardIds.includes("force-4-0"),
			);
		}
		expect(choices).toEqual(new Set([true, false]));
	});

	it("certain evidence (Lie Detector) drives suspicion and votes", () => {
		let s = startDay(startNight(deal({ seed: "ld", playerIds: IDS })));
		s = { ...s, traitorId: "p3" };
		const me = s.players[0];
		if (!me) throw new Error();
		me.hand.push({ id: "ld-x", kind: "action", action: "lieDetector" });
		s = useAction(s, "p1", {
			action: "lieDetector",
			claim: { type: "isTraitor", player: "p3" },
		}).state;
		const v = viewFor(s, "p1");
		expect(topSuspect(v)).toEqual({ player: "p3", score: expect.any(Number) });
		expect((suspicion(v).p3 ?? 0) > 50).toBe(true);
		const voteView = { ...v, public: { ...v.public, phase: "vote" as const } };
		expect(heuristicVote(voteView, "en").target).toBe("p3");
	});

	it("the bot's prompt holds only its own view", () => {
		const s = startDay(startNight(deal({ seed: "view", playerIds: IDS })));
		const text = describeView(viewFor(s, "p1"));
		for (const other of s.players.filter((p) => p.id !== "p1")) {
			for (const c of other.hand) expect(text).not.toContain(`[${c.id}]`);
		}
		for (const c of s.players[0]?.hand ?? [])
			expect(text).toContain(`[${c.id}]`);
	});
});

describe("reading the table with a decision engine", () => {
	it("an engine-read accusation outweighs mere name mentions", () => {
		const s = startDay(startNight(deal({ seed: "sig", playerIds: IDS })));
		const base = viewFor(s, "p1");
		const chat = [
			{
				id: "c1",
				round: 1,
				playerId: "p2",
				name: "Bita",
				text: "Cyrus and Dara, ready?",
				at: "",
				replyTo: null,
			},
			{
				id: "c2",
				round: 1,
				playerId: "p3",
				name: "Cyrus",
				text: "I watched Dara closely.",
				at: "",
				replyTo: null,
			},
		];
		const plain = suspicion({ ...base, chat });
		const read = suspicion({
			...base,
			chat,
			signals: { accused: { c1: null, c2: "p4" } },
		});
		expect(read.p4).toBeGreaterThan(plain.p4 ?? 0);
		expect(read.p3).toBeLessThan(plain.p3 ?? 0); // "Cyrus" in c1 was not an accusation
	});
});

describe("model-driven bots", () => {
	const actionView = () => {
		const s = startAction(
			startDay(startNight(deal({ seed: "m", playerIds: IDS }))),
		);
		return { s, v: viewFor(s, "p2") };
	};

	it("uses the model's card choice when it is legal", async () => {
		const { v } = actionView();
		const tool = v.me.hand.find((c) => c.kind === "tool");
		const r = await planAction(llm([{ cardIds: [tool?.id], reason: "x" }]), v);
		expect(r).toMatchObject({ source: "llm", plan: { cardIds: [tool?.id] } });
	});

	it("falls back to the heuristic on an illegal choice or a model error", async () => {
		const { v } = actionView();
		const bad = await planAction(
			llm([{ cardIds: ["not-in-hand"], reason: "x" }]),
			v,
		);
		expect(bad.source).toBe("mixed");
		expect(bad.plan).toEqual(heuristicAction(v));
		const down = await planAction(llm([new Error("ECONNREFUSED")]), v);
		expect(down.source).toBe("heuristic");
	});

	it("drops chat lines that leak ids and ignores action cards the bot does not hold", async () => {
		const s = startDay(startNight(deal({ seed: "d", playerIds: IDS })));
		const v = viewFor(s, "p2");
		v.me.hand = v.me.hand.filter((c) => c.kind === "tool");
		const r = await planDay(
			llm([
				{
					chat: ["p3 is lying", "I trust Ana."],
					action: { kind: "shield", target: null, question: null, round: null },
				},
			]),
			v,
		);
		expect(r.plan.chat).toEqual(["I trust Ana."]);
		expect(r.plan.action).toBeNull(); // heuristic: nothing usable in hand
		expect(r.errors.join()).toContain("not holding shield");
	});
});
