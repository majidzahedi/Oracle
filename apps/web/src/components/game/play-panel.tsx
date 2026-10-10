import type { ActionKind, Claim } from "@oracle/engine";
import type { GameView } from "@oracle/realtime";
import { Button } from "@oracle/ui/components/button";
import { cn } from "@oracle/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Skull, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { errorText } from "@/i18n";
import { orpc } from "@/utils/orpc";

import { CardFace, Section, useCardLabel, useNames } from "./common";

type Me = NonNullable<GameView["me"]>;

function useGameMutations(code: string) {
	const queryClient = useQueryClient();
	const opts = {
		onError: (e: unknown) => toast.error(errorText(e)),
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: orpc.game.view.queryOptions({ input: { code } }).queryKey,
			}),
	};
	return {
		ready: useMutation(orpc.game.ready.mutationOptions(opts)),
		pact: useMutation(orpc.game.answerPact.mutationOptions(opts)),
		play: useMutation(orpc.game.play.mutationOptions(opts)),
		act: useMutation(orpc.game.act.mutationOptions(opts)),
		vote: useMutation(orpc.game.vote.mutationOptions(opts)),
	};
}

// ---------------------------------------------------------------------------

export function SecretsPanel({ view, me }: { view: GameView; me: Me }) {
	const { t } = useTranslation();
	const name = useNames(view);
	const label = useCardLabel();
	const round = view.public.round;
	const tonight = me.messages.filter(
		(m) => m.round === round && m.kind === "night",
	);
	const earlier = me.messages
		.filter((m) => !(m.round === round && m.kind === "night"))
		.reverse();
	const questionText = useQuestionText(view);
	return (
		<Section title={t("game.secrets")} testId="secrets">
			<div
				className={cn(
					"flex items-center gap-2 border p-2",
					me.role === "traitor"
						? "border-destructive/60 text-destructive"
						: "border-border",
				)}
				data-testid="my-role"
				data-role={me.role}
			>
				{me.role === "traitor" ? (
					<Skull className="size-5" />
				) : (
					<UserRound className="size-5" />
				)}
				<div>
					<div className="font-bold">{t(`game.role.${me.role}`)}</div>
					<div className="text-xs opacity-80">
						{t(`game.roleHint.${me.role}`)}
					</div>
				</div>
			</div>
			<div className="space-y-1">
				<div className="text-muted-foreground text-xs">
					{t("game.nightMessage")}
				</div>
				{tonight.length === 0 ? (
					<p className="text-muted-foreground text-sm italic">
						{t("game.noMessage")}
					</p>
				) : (
					tonight.map((m) => (
						<blockquote
							key={m.id}
							className="border-violet-500 border-s-4 bg-violet-500/10 p-2 text-sm"
							data-testid="night-message"
							dir="auto"
						>
							{m.text}
						</blockquote>
					))
				)}
			</div>
			{me.results.length > 0 && (
				<div className="space-y-1" data-testid="results">
					<div className="text-muted-foreground text-xs">
						{t("game.results")}
					</div>
					<ul className="space-y-1 text-sm">
						{[...me.results].reverse().map((r, i) => (
							<li key={i} className="border-s-2 ps-2">
								{r.action === "decoder" &&
									(r.message ? (
										<>
											{t("game.result.decoder", { p: name(r.target) })}{" "}
											<q dir="auto">{r.message}</q>
										</>
									) : (
										t("game.result.decoderNone", { p: name(r.target) })
									))}
								{r.action === "lieDetector" && (
									<>
										{questionText(r.claim)} →{" "}
										<b>{r.answer ? t("game.yes") : t("game.no")}</b>
									</>
								)}
								{r.action === "scanner" &&
									t("game.result.scanner", {
										card: label(r.card),
										p: name(r.owner),
									})}
								{r.action === "shield" && t("game.result.shield")}
								{r.action === "override" && t("game.result.override")}
							</li>
						))}
					</ul>
				</div>
			)}
			{earlier.length > 0 && (
				<details className="text-sm">
					<summary className="cursor-pointer text-muted-foreground text-xs">
						{t("game.earlier")}
					</summary>
					<ul className="mt-1 space-y-1">
						{earlier.map((m) => (
							<li key={m.id} className="border-s-2 ps-2">
								<span className="text-muted-foreground text-xs">
									{t("game.round", { n: m.round })}:{" "}
								</span>
								{m.text}
							</li>
						))}
					</ul>
				</details>
			)}
		</Section>
	);
}

// ---------------------------------------------------------------------------

export function useQuestionText(view: GameView) {
	const { t } = useTranslation();
	const name = useNames(view);
	return (c: Claim): string => {
		switch (c.type) {
			case "isTraitor":
				return t("game.question.isTraitor", { p: name(c.player) });
			case "receivedPact":
				return t("game.question.receivedPact", { p: name(c.player) });
			case "playedOffType":
				return t("game.question.playedOffType", {
					p: name(c.player),
					r: c.round,
				});
			case "traitorExists":
				return t("game.question.traitorExists");
			default:
				return "";
		}
	};
}

/** Phase-specific controls: Pact, Ready, playing cards, votes. */
export function PhaseControls({
	view,
	me,
	code,
}: {
	view: GameView;
	me: Me;
	code: string;
}) {
	const { t } = useTranslation();
	const name = useNames(view);
	const m = useGameMutations(code);
	const phase = view.public.phase;
	const quarantined =
		view.public.seats.find((s) => s.playerId === me.playerId)?.quarantined ??
		false;
	const [selected, setSelected] = useState<string[]>([]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset selection on each new phase
	useEffect(() => setSelected([]), [phase, view.public.round]);

	if (view.public.status !== "active") return null;

	if (phase === "night" && me.pactOffer) {
		return (
			<Section
				title={t("game.pactTitle")}
				className="border-destructive/60"
				testId="pact-offer"
			>
				<p className="font-medium text-lg">{t("game.pactLine")}</p>
				<div className="flex gap-2">
					<Button
						variant="destructive"
						size="lg"
						disabled={m.pact.isPending}
						onClick={() => m.pact.mutate({ code, accept: true })}
					>
						{t("game.pactAccept")}
					</Button>
					<Button
						variant="outline"
						size="lg"
						disabled={m.pact.isPending}
						onClick={() => m.pact.mutate({ code, accept: false })}
					>
						{t("game.pactRefuse")}
					</Button>
				</div>
			</Section>
		);
	}

	if (phase === "night" || phase === "day") {
		return (
			<div className="flex items-center gap-3">
				<Button
					size="lg"
					className="min-w-32"
					disabled={me.ready || m.ready.isPending}
					onClick={() => m.ready.mutate({ code })}
					data-testid="ready"
				>
					{t("game.ready")}
				</Button>
				{me.ready && (
					<span className="text-muted-foreground text-sm">
						{t("game.readyDone")}
					</span>
				)}
			</div>
		);
	}

	if (phase === "action") {
		if (quarantined)
			return (
				<p className="text-destructive text-sm">
					{t("game.youAreQuarantined")}
				</p>
			);
		if (me.acted)
			return (
				<p className="text-muted-foreground text-sm">{t("game.played")}</p>
			);
		const tools = me.hand.filter((c) => c.kind === "tool");
		return (
			<Section title={t("game.hand")} testId="play-area">
				<p className="text-muted-foreground text-xs">{t("game.playHint")}</p>
				<div className="flex flex-wrap gap-2 pt-2">
					{me.hand.map((c) => (
						<CardFace
							key={c.id}
							card={c}
							testId={`hand-${c.id}`}
							disabled={c.kind !== "tool"}
							selected={selected.includes(c.id)}
							onClick={
								c.kind === "tool"
									? () =>
											setSelected((s) =>
												s.includes(c.id)
													? s.filter((x) => x !== c.id)
													: s.length < 2
														? [...s, c.id]
														: s,
											)
									: undefined
							}
						/>
					))}
				</div>
				<Button
					size="lg"
					disabled={
						m.play.isPending || (tools.length > 0 && selected.length === 0)
					}
					onClick={() => m.play.mutate({ code, cardIds: selected })}
					data-testid="play"
				>
					{t("game.play")}
				</Button>
			</Section>
		);
	}

	if (phase === "vote" || phase === "final") {
		const voted = me.myVote !== undefined;
		const targets = view.public.seats.filter(
			(s) => phase === "final" || s.playerId !== me.playerId,
		);
		return (
			<Section
				title={phase === "final" ? t("game.leaveBehind") : t("game.vote")}
				testId="vote-area"
			>
				<div className="flex flex-wrap gap-2">
					{targets.map((s) => (
						<Button
							key={s.playerId}
							variant={me.myVote === s.playerId ? "default" : "outline"}
							disabled={m.vote.isPending}
							onClick={() => m.vote.mutate({ code, target: s.playerId })}
							data-testid={`vote-${s.playerId}`}
						>
							{name(s.playerId)}
						</Button>
					))}
					<Button
						variant={me.myVote === null ? "default" : "outline"}
						disabled={m.vote.isPending}
						onClick={() => m.vote.mutate({ code, target: null })}
						data-testid="vote-none"
					>
						{phase === "final" ? t("game.nobody") : t("game.abstain")}
					</Button>
				</div>
				{voted && (
					<p className="text-muted-foreground text-xs">{t("game.voted")}</p>
				)}
			</Section>
		);
	}
	return null;
}

// ---------------------------------------------------------------------------

/** The hand outside the Action phase, with day action cards usable. */
export function HandPanel({
	view,
	me,
	code,
}: {
	view: GameView;
	me: Me;
	code: string;
}) {
	const { t } = useTranslation();
	const m = useGameMutations(code);
	const name = useNames(view);
	const questionText = useQuestionText(view);
	const [using, setUsing] = useState<ActionKind | null>(null);
	const phase = view.public.phase;
	// biome-ignore lint/correctness/useExhaustiveDependencies: close the picker on phase change
	useEffect(() => setUsing(null), [phase]);
	if (phase === "action" || view.public.status !== "active") return null;

	const dayCard = (a: ActionKind) => a !== "scanner";
	const others = view.public.seats.filter((s) => s.playerId !== me.playerId);
	const pastRounds = Array.from(
		{ length: Math.max(0, view.public.round - 1) },
		(_, i) => i + 1,
	);
	if (phase === "vote" && view.public.pileRound === view.public.round)
		pastRounds.push(view.public.round);
	const questions: Claim[] = [
		{ type: "traitorExists" },
		...others.map((s) => ({ type: "isTraitor" as const, player: s.playerId })),
		...others.map((s) => ({
			type: "receivedPact" as const,
			player: s.playerId,
		})),
		...pastRounds.flatMap((r) =>
			others.map((s) => ({
				type: "playedOffType" as const,
				player: s.playerId,
				round: r,
			})),
		),
	];
	const run = (input: Parameters<typeof m.act.mutate>[0]["input"]) =>
		m.act.mutate({ code, input }, { onSuccess: () => setUsing(null) });

	return (
		<Section title={t("game.hand")} testId="hand">
			<div className="flex flex-wrap gap-2">
				{me.hand.map((c) => {
					const usable =
						phase === "day" && c.kind === "action" && dayCard(c.action);
					return (
						<CardFace
							key={c.id}
							card={c}
							testId={`hand-${c.id}`}
							selected={c.kind === "action" && using === c.action}
							onClick={
								usable && c.kind === "action"
									? () => setUsing(using === c.action ? null : c.action)
									: undefined
							}
						/>
					);
				})}
			</div>
			{using && (
				<div className="space-y-2 border p-2" data-testid="action-picker">
					<p className="text-sm">{t(`game.actionHelp.${using}`)}</p>
					{using === "decoder" && (
						<div className="flex flex-wrap gap-2">
							{others.map((s) => (
								<Button
									key={s.playerId}
									variant="outline"
									size="sm"
									onClick={() => run({ action: "decoder", target: s.playerId })}
								>
									{name(s.playerId)}
								</Button>
							))}
						</div>
					)}
					{using === "lieDetector" && (
						<div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
							{questions.map((q) => (
								<Button
									key={JSON.stringify(q)}
									variant="outline"
									size="sm"
									className="justify-start whitespace-normal text-start"
									onClick={() =>
										run({ action: "lieDetector", claim: q as never })
									}
								>
									{questionText(q)}
								</Button>
							))}
						</div>
					)}
					{(using === "shield" || using === "override") && (
						<Button
							size="sm"
							onClick={() => run({ action: using })}
							disabled={m.act.isPending}
						>
							{t("game.use")} {t(`game.actions.${using}`)}
						</Button>
					)}
					<Button variant="ghost" size="sm" onClick={() => setUsing(null)}>
						{t("game.cancel")}
					</Button>
				</div>
			)}
		</Section>
	);
}

/** Scanner is used by tapping a card in the revealed pile during the vote. */
export function useScanner(view: GameView, code: string) {
	const m = useGameMutations(code);
	const me = view.me;
	const canScan =
		view.public.phase === "vote" &&
		view.public.pileRound === view.public.round &&
		Boolean(
			me?.hand.some((c) => c.kind === "action" && c.action === "scanner"),
		);
	return {
		canScan,
		scan: (pileIndex: number) =>
			m.act.mutate({ code, input: { action: "scanner", pileIndex } }),
	};
}
