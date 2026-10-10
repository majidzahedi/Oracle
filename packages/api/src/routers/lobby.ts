import { z } from "zod";

import { protectedProcedure } from "../index";
import * as lobby from "../lobby/service";

const code = z.string().min(3).max(12);
const seat = z.number().int().min(0).max(3);

const me = (ctx: {
	session: { user: { id: string; name: string } };
}): lobby.Me => ({
	id: ctx.session.user.id,
	name: ctx.session.user.name,
});

export const lobbyRouter = {
	oracleOptions: protectedProcedure.handler(({ context }) =>
		lobby.oracleOptions(context.db),
	),
	setOracle: protectedProcedure
		.input(z.object({ code, choice: z.string().min(1).max(64) }))
		.handler(({ context, input }) =>
			lobby.setOracle(context, me(context), input.code, input.choice),
		),
	create: protectedProcedure
		.input(z.object({ language: z.enum(["fa", "en"]).default("fa") }))
		.handler(({ context, input }) =>
			lobby.createGame(context, me(context), input.language),
		),
	get: protectedProcedure
		.input(z.object({ code }))
		.handler(({ context, input }) =>
			lobby.getLobby(context, me(context), input.code),
		),
	takeSeat: protectedProcedure
		.input(z.object({ code, seat }))
		.handler(({ context, input }) =>
			lobby.takeSeat(context, me(context), input.code, input.seat),
		),
	leaveSeat: protectedProcedure
		.input(z.object({ code }))
		.handler(({ context, input }) =>
			lobby.leaveSeat(context, me(context), input.code),
		),
	addBot: protectedProcedure
		.input(z.object({ code, seat }))
		.handler(({ context, input }) =>
			lobby.addBot(context, me(context), input.code, input.seat),
		),
	clearSeat: protectedProcedure
		.input(z.object({ code, seat }))
		.handler(({ context, input }) =>
			lobby.clearSeat(context, me(context), input.code, input.seat),
		),
	fillBots: protectedProcedure
		.input(z.object({ code }))
		.handler(({ context, input }) =>
			lobby.fillBots(context, me(context), input.code),
		),
	start: protectedProcedure
		.input(z.object({ code }))
		.handler(({ context, input }) =>
			lobby.startGame(context, me(context), input.code),
		),
	mine: protectedProcedure.handler(({ context }) =>
		lobby.myGames(context, me(context)),
	),
};
