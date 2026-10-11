import type { Card, ToolCard } from "@oracle/engine";
import type { GameView } from "@oracle/realtime";
import { cn } from "@oracle/ui/lib/utils";
import {
	Binary,
	Eye,
	Hammer,
	Radar,
	Scale,
	ShieldCheck,
	TimerReset,
	Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { bidiProps, stripIsolates } from "@/lib/bidi";

/** Card faces per tool type: a lit gradient, a coloured edge and an icon. */
export const TYPE_STYLE: Record<ToolCard["type"], string> = {
	power:
		"border-amber-500/70 from-amber-400/30 via-amber-500/10 to-amber-950/40 text-amber-700 shadow-amber-500/20 dark:text-amber-200",
	code: "border-sky-500/70 from-sky-400/30 via-sky-500/10 to-sky-950/40 text-sky-700 shadow-sky-500/20 dark:text-sky-200",
	force:
		"border-rose-500/70 from-rose-400/30 via-rose-500/10 to-rose-950/40 text-rose-700 shadow-rose-500/20 dark:text-rose-200",
};
const ACTION_STYLE =
	"border-violet-500/70 from-violet-400/30 via-violet-500/10 to-violet-950/40 text-violet-700 shadow-violet-500/20 dark:text-violet-200";

export const TYPE_BAR: Record<ToolCard["type"], string> = {
	power: "from-amber-600 to-amber-300 shadow-[0_0_12px] shadow-amber-500/50",
	code: "from-sky-600 to-sky-300 shadow-[0_0_12px] shadow-sky-500/50",
	force: "from-rose-600 to-rose-300 shadow-[0_0_12px] shadow-rose-500/50",
};
export const TYPE_TEXT: Record<ToolCard["type"], string> = {
	power: "text-amber-600 dark:text-amber-300",
	code: "text-sky-600 dark:text-sky-300",
	force: "text-rose-600 dark:text-rose-300",
};

export const TYPE_ICON = { power: Zap, code: Binary, force: Hammer } as const;

const ACTION_ICON = {
	decoder: Eye,
	lieDetector: Scale,
	shield: ShieldCheck,
	override: TimerReset,
	scanner: Radar,
} as const;

/** Display names keyed by engine player id; bots get a localized name. */
export function useNames(view: GameView | undefined) {
	const { t } = useTranslation();
	const map: Record<string, string> = {};
	for (const s of view?.public.seats ?? []) {
		map[s.playerId] = s.isBot ? t("lobby.botName", { n: s.seat + 1 }) : s.name;
	}
	return (id: string | null | undefined) => (id ? (map[id] ?? id) : "");
}

/**
 * Props for a free-text line (Oracle message, chat): its direction and its text
 * with player names isolated. Names are both the stored ones (the server writes
 * "Bot 2") and the localized ones.
 */
export function useBidi(view: GameView | undefined) {
	const { t } = useTranslation();
	const names = (view?.public.seats ?? []).flatMap((s) =>
		s.isBot ? [s.name, t("lobby.botName", { n: s.seat + 1 })] : [s.name],
	);
	return (text: string) => bidiProps(text, names);
}

export function useCardLabel() {
	const { t, i18n } = useTranslation();
	return (c: Card) =>
		c.kind === "tool"
			? `${t(`game.types.${c.type}`)} ${new Intl.NumberFormat(i18n.language).format(c.value)}`
			: t(`game.actions.${c.action}`);
}

export function CardFace({
	card,
	selected,
	disabled,
	onClick,
	small,
	testId,
}: {
	card: Card;
	selected?: boolean;
	disabled?: boolean;
	onClick?: () => void;
	small?: boolean;
	testId?: string;
}) {
	const { t, i18n } = useTranslation();
	const fmt = new Intl.NumberFormat(i18n.language);
	const Icon =
		card.kind === "tool" ? TYPE_ICON[card.type] : ACTION_ICON[card.action];
	const label =
		card.kind === "tool"
			? t(`game.types.${card.type}`)
			: t(`game.actions.${card.action}`);
	const base = cn(
		"relative flex shrink-0 select-none flex-col items-center justify-between overflow-hidden rounded-md border-2 bg-gradient-to-b font-medium shadow-lg backdrop-blur-sm transition duration-200",
		small
			? "h-16 w-12 p-1 text-[9px]"
			: "h-[6.5rem] w-[4.6rem] p-1.5 text-[11px]",
		card.kind === "tool" ? TYPE_STYLE[card.type] : ACTION_STYLE,
		selected &&
			"-translate-y-3 shadow-xl ring-2 ring-primary ring-offset-2 ring-offset-background",
		onClick &&
			!disabled &&
			"cursor-pointer hover:-translate-y-1.5 hover:brightness-110",
		disabled && "opacity-45 saturate-50",
	);
	const content = (
		<>
			{/* subtle sheen */}
			<span className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/15 via-transparent to-transparent" />
			{card.kind === "tool" ? (
				<>
					<span className="flex w-full items-center justify-between font-mono text-[10px] leading-none">
						<span>{fmt.format(card.value)}</span>
						<Icon className="size-3" />
					</span>
					<span
						className={cn(
							"font-bold font-mono leading-none",
							small ? "text-xl" : "text-4xl",
						)}
					>
						{fmt.format(card.value)}
					</span>
					<span className="truncate leading-none">{label}</span>
				</>
			) : (
				<>
					<span className="h-2" />
					<Icon className={small ? "size-5" : "size-8"} />
					<span className="text-center leading-tight">{label}</span>
				</>
			)}
		</>
	);
	if (!onClick) {
		return (
			<div className={base} data-testid={testId} title={label}>
				{content}
			</div>
		);
	}
	return (
		<button
			type="button"
			className={base}
			disabled={disabled}
			onClick={onClick}
			aria-pressed={selected}
			aria-label={
				card.kind === "tool" ? `${label} ${fmt.format(card.value)}` : label
			}
			data-testid={testId}
		>
			{content}
		</button>
	);
}

/** Seconds until an ISO deadline, ticking every second. */
export function useCountdown(deadline: string | null): number | null {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, []);
	if (!deadline) return null;
	return Math.max(0, Math.round((new Date(deadline).getTime() - now) / 1000));
}

/** Fraction of the phase left (1 → 0), measured from when this tab first saw the deadline. */
export function useTimeFraction(
	deadline: string | null,
	left: number | null,
): number | null {
	const start = useRef<{ deadline: string | null; total: number }>({
		deadline: null,
		total: 0,
	});
	if (deadline !== start.current.deadline)
		start.current = { deadline, total: left ?? 0 };
	if (left === null || start.current.total <= 0) return null;
	return Math.min(1, left / start.current.total);
}

export function formatClock(seconds: number, lang: string) {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	const f = new Intl.NumberFormat(lang, { minimumIntegerDigits: 2 });
	return `${new Intl.NumberFormat(lang).format(m)}:${f.format(s)}`;
}

export function Section({
	title,
	children,
	className,
	testId,
	icon,
}: {
	title: string;
	children: React.ReactNode;
	className?: string;
	testId?: string;
	icon?: React.ReactNode;
}) {
	return (
		<section
			className={cn("panel space-y-3 p-3 sm:p-4", className)}
			data-testid={testId}
		>
			<h2 className="panel-title flex items-center gap-2">
				{icon}
				{title}
			</h2>
			{children}
		</section>
	);
}

const SEAT_COLORS = [
	"bg-amber-500/20 text-amber-700 ring-amber-500/60 dark:text-amber-200",
	"bg-sky-500/20 text-sky-700 ring-sky-500/60 dark:text-sky-200",
	"bg-rose-500/20 text-rose-700 ring-rose-500/60 dark:text-rose-200",
	"bg-emerald-500/20 text-emerald-700 ring-emerald-500/60 dark:text-emerald-200",
];

/** A prisoner's token: initials in their seat colour. */
export function Avatar({
	name,
	seat,
	className,
}: {
	name: string;
	seat: number;
	className?: string;
}) {
	const initials =
		stripIsolates(name).trim().slice(0, 1).toLocaleUpperCase() || "?";
	return (
		<span
			className={cn(
				"inline-flex size-8 shrink-0 items-center justify-center rounded-full font-bold ring-2",
				SEAT_COLORS[seat % SEAT_COLORS.length],
				className,
			)}
			aria-hidden="true"
		>
			{initials}
		</span>
	);
}
