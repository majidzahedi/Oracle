import { LOCKS } from "@oracle/engine";
import type { GameView } from "@oracle/realtime";
import { cn } from "@oracle/ui/lib/utils";
import { Bot, Check, Lock, Timer } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
	formatClock,
	Section,
	TYPE_BAR,
	useCountdown,
	useNames,
} from "./common";

type Pub = GameView["public"];

export function PhaseBar({ view }: { view: Pub }) {
	const { t, i18n } = useTranslation();
	const left = useCountdown(view.status === "active" ? view.deadline : null);
	const fmt = new Intl.NumberFormat(i18n.language);
	const danger = view.lockdown >= 9;
	return (
		<div
			className="space-y-2 border bg-card p-3"
			data-testid="phase-bar"
			data-phase={view.phase}
			data-round={view.round}
		>
			<div className="flex items-center justify-between gap-2">
				<div>
					<div className="font-bold text-lg">
						{t("game.round", { n: view.round })} ·{" "}
						{t(`game.phase.${view.phase}`)}
					</div>
					<p className="text-muted-foreground text-xs">
						{t(`game.phaseHint.${view.phase}`)}
					</p>
				</div>
				{left !== null && (
					<div
						className={cn(
							"flex items-center gap-1 font-mono text-xl tabular-nums",
							left <= 10 && "text-destructive",
						)}
						title={t("game.timeLeft")}
						dir="ltr"
					>
						<Timer className="size-5" />
						{formatClock(left, i18n.language)}
					</div>
				)}
			</div>
			<div>
				<div className="mb-1 flex justify-between text-xs">
					<span title={t("game.lockdownHint")}>{t("game.lockdown")}</span>
					<span
						className={cn("font-mono", danger && "text-destructive")}
						data-testid="lockdown"
					>
						{fmt.format(view.lockdown)} / {fmt.format(12)}
					</span>
				</div>
				<div className="grid grid-cols-12 gap-0.5" aria-hidden>
					{Array.from({ length: 12 }, (_, i) => (
						<div
							key={i}
							className={cn(
								"h-2.5",
								i < view.lockdown
									? i >= 8
										? "bg-destructive"
										: "bg-amber-500"
									: "bg-muted",
							)}
						/>
					))}
				</div>
			</div>
		</div>
	);
}

export function SectorBoard({ view }: { view: Pub }) {
	const { t, i18n } = useTranslation();
	const fmt = new Intl.NumberFormat(i18n.language);
	const lock = LOCKS[Math.min(view.sector, LOCKS.length - 1)];
	return (
		<Section
			title={t(`game.sectors.${view.lockName as "generator"}`)}
			testId="board"
		>
			<ol className="grid grid-cols-4 gap-1 text-center text-[11px]">
				{LOCKS.map((l, i) => (
					<li
						key={l.name}
						className={cn(
							"flex flex-col items-center gap-0.5 border p-1",
							i < view.sector &&
								"border-green-600/60 text-green-600 dark:text-green-400",
							i === view.sector && "border-primary font-medium",
							i > view.sector && "text-muted-foreground",
						)}
					>
						{i < view.sector ? (
							<Check className="size-4" />
						) : (
							<Lock className="size-4" />
						)}
						<span className="leading-tight">
							{t(`game.sectors.${l.name as "generator"}`)}
						</span>
					</li>
				))}
			</ol>
			{lock && view.sector < LOCKS.length && (
				<div className="space-y-2 pt-1">
					{lock.requirements.map((r, idx) => {
						const target = view.targets[r.type] ?? r.amount;
						const have = view.progress[r.type];
						const pct = Math.min(100, (have / target) * 100);
						return (
							<div key={r.type} data-testid={`progress-${r.type}`}>
								<div className="mb-0.5 flex justify-between text-xs">
									<span>
										{t(`game.types.${r.type}`)}
										{idx === 0 && view.jam > 0 && (
											<span className="ms-2 text-destructive">
												{t("game.jam", { n: view.jam })}
											</span>
										)}
									</span>
									<span className="font-mono">
										{fmt.format(have)} / {fmt.format(target)}
									</span>
								</div>
								<div className="h-3 bg-muted">
									<div
										className={cn("h-3 transition-all", TYPE_BAR[r.type])}
										style={{ width: `${pct}%` }}
									/>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</Section>
	);
}

export function PlayersList({
	view,
	me,
}: {
	view: GameView;
	me: string | undefined;
}) {
	const { t, i18n } = useTranslation();
	const name = useNames(view);
	const fmt = new Intl.NumberFormat(i18n.language);
	return (
		<Section title={t("game.players")} testId="players">
			<ul className="divide-y">
				{view.public.seats.map((s) => (
					<li
						key={s.playerId}
						className="flex items-center justify-between gap-2 py-1.5"
						data-testid={`player-${s.playerId}`}
					>
						<span className="flex min-w-0 items-center gap-1.5">
							{s.isBot && (
								<Bot className="size-4 shrink-0" aria-label={t("game.bot")} />
							)}
							<span
								className={cn("truncate", s.playerId === me && "font-bold")}
							>
								{name(s.playerId)}
							</span>
							{s.playerId === me && (
								<span className="text-muted-foreground text-xs">
									({t("game.you")})
								</span>
							)}
							{s.quarantined && (
								<span className="border border-destructive/50 px-1 text-[10px] text-destructive">
									{t("game.quarantined")}
								</span>
							)}
						</span>
						<span className="flex shrink-0 items-center gap-2 text-muted-foreground text-xs">
							<span>{t("game.cards", { count: s.handCount })}</span>
							{view.public.status === "active" && (
								<span
									className={cn(
										"inline-flex items-center gap-1",
										s.status === "done" && "text-green-600 dark:text-green-400",
									)}
									data-status={s.status}
								>
									<span className="size-2 rounded-full bg-current" />
									{t(`game.status.${s.status}`)}
								</span>
							)}
							<span className="sr-only">{fmt.format(s.seat + 1)}</span>
						</span>
					</li>
				))}
			</ul>
		</Section>
	);
}
