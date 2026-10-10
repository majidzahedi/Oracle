import type { Card, ToolCard } from "@oracle/engine";
import type { GameView } from "@oracle/realtime";
import { cn } from "@oracle/ui/lib/utils";
import { Eye, Radar, Scale, ShieldCheck, TimerReset } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export const TYPE_STYLE: Record<ToolCard["type"], string> = {
	power:
		"border-amber-500/70 bg-amber-500/15 text-amber-600 dark:text-amber-300",
	code: "border-sky-500/70 bg-sky-500/15 text-sky-600 dark:text-sky-300",
	force: "border-rose-500/70 bg-rose-500/15 text-rose-600 dark:text-rose-300",
};
export const TYPE_BAR: Record<ToolCard["type"], string> = {
	power: "bg-amber-500",
	code: "bg-sky-500",
	force: "bg-rose-500",
};

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
	const base = cn(
		"relative flex shrink-0 flex-col items-center justify-between border-2 font-medium transition",
		small ? "h-16 w-12 p-1 text-[10px]" : "h-24 w-[4.5rem] p-1.5 text-xs",
		selected && "-translate-y-2 ring-2 ring-primary",
		onClick && !disabled && "cursor-pointer hover:-translate-y-1",
		disabled && "opacity-50",
	);
	const content =
		card.kind === "tool" ? (
			<>
				<span>{t(`game.types.${card.type}`)}</span>
				<span className={small ? "text-xl" : "text-3xl"}>
					{fmt.format(card.value)}
				</span>
				<span className="opacity-0">.</span>
			</>
		) : (
			<>
				<span className="text-center leading-tight">
					{t(`game.actions.${card.action}`)}
				</span>
				{(() => {
					const Icon = ACTION_ICON[card.action];
					return <Icon className={small ? "size-5" : "size-7"} />;
				})()}
				<span className="opacity-0">.</span>
			</>
		);
	const style =
		card.kind === "tool"
			? TYPE_STYLE[card.type]
			: "border-violet-500/70 bg-violet-500/15 text-violet-600 dark:text-violet-300";
	if (!onClick) {
		return (
			<div className={cn(base, style)} data-testid={testId}>
				{content}
			</div>
		);
	}
	return (
		<button
			type="button"
			className={cn(base, style)}
			disabled={disabled}
			onClick={onClick}
			aria-pressed={selected}
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
}: {
	title: string;
	children: React.ReactNode;
	className?: string;
	testId?: string;
}) {
	return (
		<section
			className={cn("space-y-2 border bg-card p-3", className)}
			data-testid={testId}
		>
			<h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
				{title}
			</h2>
			{children}
		</section>
	);
}
