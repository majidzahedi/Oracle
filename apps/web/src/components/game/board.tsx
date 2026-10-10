import { LOCKS } from "@oracle/engine";
import type { GameView } from "@oracle/realtime";
import { cn } from "@oracle/ui/lib/utils";
import {
	Bot,
	Check,
	DoorOpen,
	Gavel,
	Hand,
	Lock,
	LockOpen,
	Moon,
	Siren,
	Skull,
	Sun,
	Timer,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
	Avatar,
	formatClock,
	Section,
	TYPE_BAR,
	TYPE_ICON,
	TYPE_TEXT,
	useCountdown,
	useNames,
	useTimeFraction,
} from "./common";

type Pub = GameView["public"];

const PHASE_ICON = {
	setup: Moon,
	night: Moon,
	day: Sun,
	action: Hand,
	vote: Gavel,
	final: DoorOpen,
	ended: Skull,
} as const;

const PHASE_TONE: Record<Pub["phase"], string> = {
	setup: "text-muted-foreground ring-border",
	night:
		"text-violet-500 ring-violet-500/50 bg-violet-500/10 dark:text-violet-300",
	day: "text-amber-600 ring-amber-500/50 bg-amber-500/10 dark:text-amber-300",
	action: "text-sky-600 ring-sky-500/50 bg-sky-500/10 dark:text-sky-300",
	vote: "text-alarm ring-alarm/50 bg-alarm/10",
	final: "text-safe ring-safe/50 bg-safe/10",
	ended: "text-muted-foreground ring-border",
};

/** The HUD: round and phase, the countdown, and the Lockdown alarm. */
export function PhaseBar({ view }: { view: Pub }) {
	const { t, i18n } = useTranslation();
	const deadline = view.status === "active" ? view.deadline : null;
	const left = useCountdown(deadline);
	const fraction = useTimeFraction(deadline, left);
	const fmt = new Intl.NumberFormat(i18n.language);
	const PhaseIcon = PHASE_ICON[view.phase];
	const critical = view.lockdown >= 9;
	return (
		<div
			className="panel space-y-3 p-3 sm:p-4"
			data-testid="phase-bar"
			data-phase={view.phase}
			data-round={view.round}
		>
			<div className="flex items-center gap-3">
				<span
					className={cn(
						"inline-flex size-11 shrink-0 items-center justify-center rounded-full ring-2",
						PHASE_TONE[view.phase],
					)}
				>
					<PhaseIcon className="size-5" />
				</span>
				<div className="min-w-0 flex-1">
					<div className="font-mono text-[11px] text-muted-foreground uppercase tracking-widest">
						{t("game.round", { n: view.round })}
					</div>
					<div className="display font-bold text-xl leading-tight">
						{t(`game.phase.${view.phase}`)}
					</div>
				</div>
				{left !== null && (
					<div className="text-end" title={t("game.timeLeft")}>
						<div
							className={cn(
								"flex items-center gap-1 font-bold font-mono text-2xl tabular-nums",
								left <= 10 && "text-alarm",
							)}
							dir="ltr"
						>
							<Timer className="size-4 opacity-60" />
							{formatClock(left, i18n.language)}
						</div>
					</div>
				)}
			</div>
			{fraction !== null && (
				<div className="h-1 overflow-hidden bg-muted" aria-hidden="true">
					<div
						className={cn(
							"h-full transition-[width] duration-1000 ease-linear",
							left !== null && left <= 10 ? "bg-alarm" : "bg-primary",
						)}
						style={{ width: `${fraction * 100}%` }}
					/>
				</div>
			)}
			{t(`game.phaseHint.${view.phase}`) && (
				<p className="text-muted-foreground text-sm">
					{t(`game.phaseHint.${view.phase}`)}
				</p>
			)}

			<div>
				<div className="mb-1.5 flex items-center justify-between text-xs">
					<span
						className="flex items-center gap-1.5 font-medium"
						title={t("game.lockdownHint")}
					>
						<Siren
							className={cn(
								"size-3.5",
								critical ? "text-alarm" : "text-muted-foreground",
							)}
						/>
						{t("game.lockdown")}
					</span>
					<span
						className={cn("font-bold font-mono", critical && "text-alarm")}
						data-testid="lockdown"
					>
						{fmt.format(view.lockdown)} / {fmt.format(12)}
					</span>
				</div>
				<meter
					className="sr-only"
					min={0}
					max={12}
					high={9}
					value={view.lockdown}
					aria-label={t("game.lockdown")}
				/>
				<div
					className={cn(
						"grid grid-cols-12 gap-1",
						critical && view.status === "active" && "alarm-pulse",
					)}
					aria-hidden="true"
				>
					{Array.from({ length: 12 }, (_, i) => (
						<div
							key={`seg-${i + 1}`}
							className={cn(
								"h-3 skew-x-[-12deg] transition-colors",
								i >= view.lockdown
									? "bg-muted"
									: i >= 8
										? "bg-alarm shadow-[0_0_10px] shadow-alarm/60"
										: i >= 5
											? "bg-orange-500"
											: "bg-amber-400",
							)}
						/>
					))}
				</div>
			</div>
		</div>
	);
}

/** The way out: four vault doors, and the current lock's progress. */
export function SectorBoard({ view }: { view: Pub }) {
	const { t, i18n } = useTranslation();
	const fmt = new Intl.NumberFormat(i18n.language);
	const lock = LOCKS[Math.min(view.sector, LOCKS.length - 1)];
	return (
		<Section
			title={t(`game.sectors.${view.lockName as "generator"}`)}
			testId="board"
			icon={<Lock className="size-3.5" />}
		>
			<ol className="relative grid grid-cols-4 gap-1 text-center text-[11px]">
				<span
					className="absolute inset-x-[12.5%] top-5 h-0.5 bg-border"
					aria-hidden="true"
				/>
				<span
					className="absolute start-[12.5%] top-5 h-0.5 bg-safe transition-all"
					style={{ width: `${(Math.min(view.sector, 3) / 3) * 75}%` }}
					aria-hidden="true"
				/>
				{LOCKS.map((l, i) => {
					const open = i < view.sector;
					const current = i === view.sector;
					return (
						<li
							key={l.name}
							className="relative flex flex-col items-center gap-1.5"
						>
							<span
								className={cn(
									"relative z-10 inline-flex size-10 items-center justify-center rounded-full border-2 bg-card",
									open &&
										"border-safe text-safe shadow-[0_0_14px] shadow-safe/40",
									current && "eye-pulse border-primary text-primary",
									!open && !current && "border-border text-muted-foreground",
								)}
							>
								{open ? (
									<Check className="size-5" />
								) : current ? (
									<LockOpen className="size-5" />
								) : (
									<Lock className="size-4" />
								)}
							</span>
							<span
								className={cn(
									"leading-tight",
									current ? "font-semibold" : "text-muted-foreground",
								)}
							>
								{t(`game.sectors.${l.name as "generator"}`)}
							</span>
						</li>
					);
				})}
			</ol>
			{lock && view.sector < LOCKS.length && (
				<div className="space-y-3 pt-1">
					{lock.requirements.map((r, idx) => {
						const target = view.targets[r.type] ?? r.amount;
						const have = view.progress[r.type];
						const pct = Math.min(100, (have / target) * 100);
						const Icon = TYPE_ICON[r.type];
						return (
							<div key={r.type} data-testid={`progress-${r.type}`}>
								<div className="mb-1 flex items-center justify-between text-xs">
									<span
										className={cn(
											"flex items-center gap-1.5 font-medium",
											TYPE_TEXT[r.type],
										)}
									>
										<Icon className="size-3.5" />
										{t(`game.types.${r.type}`)}
										{idx === 0 && view.jam > 0 && (
											<span className="ms-1 border border-alarm/50 px-1 text-[10px] text-alarm">
												{t("game.jam", { n: view.jam })}
											</span>
										)}
									</span>
									<span className="font-mono">
										{fmt.format(have)} / {fmt.format(target)}
									</span>
								</div>
								<div className="h-2.5 overflow-hidden rounded-full bg-muted">
									<div
										className={cn(
											"h-full rounded-full bg-gradient-to-r transition-all duration-700",
											TYPE_BAR[r.type],
										)}
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

/** The four prisoners: who they are, and how far they are in this phase. */
export function PlayersList({
	view,
	me,
}: {
	view: GameView;
	me: string | undefined;
}) {
	const { t } = useTranslation();
	const name = useNames(view);
	return (
		<Section title={t("game.players")} testId="players">
			<ul className="space-y-1.5">
				{view.public.seats.map((s) => (
					<li
						key={s.playerId}
						className={cn(
							"flex items-center justify-between gap-2 rounded-md px-2 py-1.5",
							s.playerId === me && "bg-primary/5 ring-1 ring-primary/30",
						)}
						data-testid={`player-${s.playerId}`}
					>
						<span className="flex min-w-0 items-center gap-2">
							{s.isBot ? (
								<span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted ring-2 ring-border">
									<Bot className="size-4" aria-label={t("game.bot")} />
								</span>
							) : (
								<Avatar
									name={name(s.playerId)}
									seat={s.seat}
									className={cn(s.away && "opacity-40")}
								/>
							)}
							<span className="min-w-0">
								<span
									className={cn(
										"block truncate",
										s.playerId === me && "font-bold",
									)}
								>
									{name(s.playerId)}
									{s.playerId === me && (
										<span className="ms-1 text-muted-foreground text-xs">
											({t("game.you")})
										</span>
									)}
								</span>
								<span className="flex flex-wrap gap-1">
									{s.quarantined && (
										<span className="border border-alarm/50 px-1 text-[10px] text-alarm">
											{t("game.quarantined")}
										</span>
									)}
									{s.away && view.public.status === "active" && (
										<span
											className="border px-1 text-[10px] text-muted-foreground"
											data-testid={`away-${s.playerId}`}
										>
											{t("game.away")}
										</span>
									)}
								</span>
							</span>
						</span>
						<span className="flex shrink-0 items-center gap-2 text-muted-foreground text-xs">
							<span className="font-mono">
								{t("game.cards", { count: s.handCount })}
							</span>
							{view.public.status === "active" && (
								<span
									className={cn(
										"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
										s.status === "done"
											? "bg-safe/15 text-safe"
											: s.status === "quarantined"
												? "bg-alarm/10 text-alarm"
												: "bg-muted",
									)}
									data-status={s.status}
								>
									<span
										className={cn(
											"size-1.5 rounded-full bg-current",
											s.status === "waiting" && "animate-pulse",
										)}
									/>
									{t(`game.status.${s.status}`)}
								</span>
							)}
						</span>
					</li>
				))}
			</ul>
		</Section>
	);
}
