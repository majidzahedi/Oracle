import type { GameView } from "@oracle/realtime";
import { Button } from "@oracle/ui/components/button";
import { cn } from "@oracle/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { DoorOpen } from "lucide-react";
import { useTranslation } from "react-i18next";

import { OracleEye } from "@/components/oracle-eye";

import { Section, useCardLabel, useNames } from "./common";

export function EndScreen({ view }: { view: GameView }) {
	const { t } = useTranslation();
	const name = useNames(view);
	const label = useCardLabel();
	const o = view.public.outcome;
	const log = view.public.log;
	if (!o || !log) return null;

	let headline: string;
	if (o.kind === "sealed")
		headline = o.winners.includes("traitor")
			? t("game.outcome.sealedTraitor")
			: t("game.outcome.sealed");
	else if (o.escape === "bitter" && o.traitorEscaped)
		headline = t("game.outcome.bitterTraitor");
	else headline = t(`game.outcome.${o.escape}`);
	const playersWon = o.kind === "escaped" && o.winners.includes("players");
	const iWon =
		(view.me?.role === "traitor" && o.winners.includes("traitor")) ||
		(view.me?.role === "innocent" && playersWon);

	return (
		<div
			className="space-y-4"
			data-testid="end-screen"
			data-outcome={o.kind === "sealed" ? "sealed" : o.escape}
		>
			<div
				className={cn(
					"panel flex flex-col items-center gap-3 overflow-hidden px-4 py-8 text-center",
					playersWon
						? "border-safe/60 bg-[radial-gradient(ellipse_at_50%_0%,color-mix(in_oklch,var(--safe)_25%,transparent),transparent_70%)]"
						: "border-alarm/60 bg-[radial-gradient(ellipse_at_50%_0%,color-mix(in_oklch,var(--alarm)_25%,transparent),transparent_70%)]",
				)}
			>
				{playersWon ? (
					<DoorOpen className="size-12 text-safe drop-shadow-[0_0_12px_var(--safe)]" />
				) : (
					<OracleEye className="h-14 w-24 text-alarm" />
				)}
				<p className="display max-w-xl font-bold text-2xl leading-snug sm:text-3xl">
					{headline}
				</p>
				{o.kind === "escaped" && o.leftBehind && (
					<p className="text-muted-foreground">
						{t("game.outcome.leftBehind", { p: name(o.leftBehind) })}
					</p>
				)}
				{view.me && (
					<p
						className={cn(
							"display rounded-full border px-4 py-1 font-semibold text-sm uppercase",
							iWon ? "border-safe/60 text-safe" : "border-alarm/60 text-alarm",
						)}
					>
						{iWon ? t("game.youWon") : t("game.youLost")}
					</p>
				)}
			</div>

			<Section
				title={t("game.log.title")}
				testId="oracle-log"
				icon={<OracleEye className="h-3 w-5" watching={false} />}
			>
				<h3 className="font-medium">{t("game.log.roles")}</h3>
				<p data-testid="log-traitor">
					{log.traitor
						? t("game.log.traitor", { p: name(log.traitor) })
						: t("game.log.noTraitor")}
				</p>

				<h3 className="pt-2 font-medium">{t("game.log.messages")}</h3>
				<div className="space-y-2" data-testid="log-messages">
					{[...new Set(log.messages.map((m) => m.round))].map((round) => (
						<div key={round}>
							<div className="font-medium text-muted-foreground text-xs">
								{t("game.round", { n: round })}
							</div>
							<ul className="space-y-1 text-sm">
								{log.messages
									.filter((m) => m.round === round)
									.map((m) => (
										<li key={m.id} className="flex gap-2 border-s-2 ps-2">
											<span className="shrink-0 text-muted-foreground text-xs">
												{m.to
													? t("game.log.to", { p: name(m.to) })
													: t("game.log.public")}
											</span>
											<span className="flex-1" dir="auto">
												{m.text}
											</span>
											{m.truth !== null && (
												<span
													className={cn(
														"shrink-0 font-medium text-xs",
														m.truth
															? "text-green-600 dark:text-green-400"
															: "text-destructive",
													)}
													data-truth={m.truth}
												>
													{m.truth ? t("game.log.true") : t("game.log.false")}
												</span>
											)}
										</li>
									))}
							</ul>
						</div>
					))}
				</div>

				<h3 className="pt-2 font-medium">{t("game.log.pact")}</h3>
				{log.pactOffers.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						{t("game.log.pactNone")}
					</p>
				) : (
					<ul className="text-sm">
						{log.pactOffers.map((p) => (
							<li key={p.round}>
								{t("game.round", { n: p.round })}: {name(p.player)} —{" "}
								{p.accepted ? t("game.log.accepted") : t("game.log.refused")}
							</li>
						))}
					</ul>
				)}

				<h3 className="pt-2 font-medium">{t("game.log.threats")}</h3>
				<ul className="text-sm">
					{log.threats.map((th) => (
						<li key={th.round}>
							{t("game.round", { n: th.round })}:{" "}
							{t(`game.threats.${th.threat}`)}
							{th.shielded && ` (${t("game.log.shielded")})`}
							{th.favoredPlayer &&
								` — ${t("game.log.favored", { p: name(th.favoredPlayer) })}`}
						</li>
					))}
				</ul>

				<h3 className="pt-2 font-medium">{t("game.log.offType")}</h3>
				{log.offTypePlays.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						{t("game.log.offTypeNone")}
					</p>
				) : (
					<ul className="text-sm" data-testid="log-offtype">
						{log.offTypePlays.map((p) => (
							<li key={`${p.round}-${p.card.id}`}>
								{t("game.log.playedBy", {
									card: label(p.card),
									p: name(p.owner),
									r: p.round,
								})}
							</li>
						))}
					</ul>
				)}
			</Section>
			<Link to="/">
				<Button variant="outline">{t("game.backHome")}</Button>
			</Link>
		</div>
	);
}
