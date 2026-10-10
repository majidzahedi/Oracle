import { z } from "zod";

import * as game from "../game/actions";
import { protectedProcedure } from "../index";

const code = z.string().min(3).max(12);
const pid = z.string().regex(/^p[1-4]$/);

/** Lie Detector questions are limited to claim templates the engine can evaluate. */
const question = z.discriminatedUnion("type", [
	z.object({ type: z.literal("isTraitor"), player: pid }),
	z.object({ type: z.literal("receivedPact"), player: pid }),
	z.object({
		type: z.literal("playedOffType"),
		player: pid,
		round: z.number().int().min(1),
	}),
	z.object({ type: z.literal("traitorExists") }),
]);

const actionInput = z.discriminatedUnion("action", [
	z.object({ action: z.literal("decoder"), target: pid }),
	z.object({ action: z.literal("lieDetector"), claim: question }),
	z.object({ action: z.literal("shield") }),
	z.object({ action: z.literal("override") }),
	z.object({
		action: z.literal("scanner"),
		pileIndex: z.number().int().min(0),
	}),
]);

const uid = (ctx: { session: { user: { id: string } } }) => ctx.session.user.id;

export const gameRouter = {
	view: protectedProcedure
		.input(z.object({ code }))
		.handler(({ context, input }) =>
			game.getView(context, uid(context), input.code),
		),
	heartbeat: protectedProcedure
		.input(z.object({ code }))
		.handler(({ context, input }) =>
			game.heartbeat(context, uid(context), input.code),
		),
	ready: protectedProcedure
		.input(z.object({ code }))
		.handler(({ context, input }) =>
			game.ready(context, uid(context), input.code),
		),
	answerPact: protectedProcedure
		.input(z.object({ code, accept: z.boolean() }))
		.handler(({ context, input }) =>
			game.answerPact(context, uid(context), input.code, input.accept),
		),
	play: protectedProcedure
		.input(z.object({ code, cardIds: z.array(z.string()).max(2) }))
		.handler(({ context, input }) =>
			game.play(context, uid(context), input.code, input.cardIds),
		),
	act: protectedProcedure
		.input(z.object({ code, input: actionInput }))
		.handler(({ context, input }) =>
			game.act(context, uid(context), input.code, input.input),
		),
	vote: protectedProcedure
		.input(z.object({ code, target: pid.nullable() }))
		.handler(({ context, input }) =>
			game.vote(context, uid(context), input.code, input.target),
		),
	chat: protectedProcedure
		.input(z.object({ code, text: z.string().min(1).max(300) }))
		.handler(({ context, input }) =>
			game.chat(context, uid(context), input.code, input.text),
		),
};
