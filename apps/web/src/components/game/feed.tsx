import type { FeedEntry } from "@oracle/engine";
import type { ChatMessage, ChatQuote, GameView } from "@oracle/realtime";
import { Button } from "@oracle/ui/components/button";
import { Input } from "@oracle/ui/components/input";
import { cn } from "@oracle/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { Reply, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { errorText } from "@/i18n";
import { orpc } from "@/utils/orpc";

import { CardFace, Section, useBidi, useNames } from "./common";
import { useScanner } from "./play-panel";

function useFeedText(view: GameView) {
	const { t } = useTranslation();
	const name = useNames(view);
	const sector = (i: number) => {
		const names = [
			"generator",
			"securityTerminal",
			"pressureGate",
			"exit",
		] as const;
		return t(`game.sectors.${names[Math.min(i, 3)] ?? "exit"}`);
	};
	return (f: FeedEntry): string | null => {
		switch (f.kind) {
			case "roundStarted":
				return t("game.feedEntry.roundStarted", { n: f.round });
			case "actionUsed":
				return t("game.feedEntry.actionUsed", {
					p: name(f.player),
					action: t(`game.actions.${f.action}`),
				});
			case "cardsPlayed":
				return f.count > 0
					? t("game.feedEntry.cardsPlayed", {
							p: name(f.player),
							count: f.count,
						})
					: t("game.feedEntry.cardsPlayedNone", { p: name(f.player) });
			case "pileRevealed":
				return t("game.feedEntry.pileRevealed", { n: f.pile.length });
			case "lockResolved":
				return t(
					f.opened ? "game.feedEntry.lockOpened" : "game.feedEntry.lockFailed",
					{ sector: sector(f.sector) },
				);
			case "threat":
				return t("game.feedEntry.threat", {
					threat: t(`game.threats.${f.announced as "jam"}`),
				});
			case "lockdown":
				if (f.delta === 0) return null;
				return t(
					f.delta > 0
						? "game.feedEntry.lockdownUp"
						: "game.feedEntry.lockdownDown",
					{
						n: Math.abs(f.delta),
						v: f.value,
					},
				);
			case "quarantine":
				return f.player
					? t("game.feedEntry.quarantine", { p: name(f.player) })
					: t("game.feedEntry.quarantineNone");
			case "gameOver":
				return t("game.feedEntry.gameOver");
		}
	};
}

export function FeedAndChat({ view, code }: { view: GameView; code: string }) {
	const { t } = useTranslation();
	const [tab, setTab] = useState<"feed" | "chat">("feed");
	const [seenChat, setSeenChat] = useState(view.chat.length);
	useEffect(() => {
		if (tab === "chat") setSeenChat(view.chat.length);
	}, [tab, view.chat.length]);
	const unread = view.chat.length - seenChat;
	return (
		<section className="panel flex min-h-80 flex-col">
			<div className="flex border-b" role="tablist">
				{(["feed", "chat"] as const).map((k) => (
					<button
						key={k}
						type="button"
						role="tab"
						aria-selected={tab === k}
						className={cn(
							"panel-title flex-1 px-3 py-2.5 transition-colors",
							tab === k
								? "border-primary border-b-2 text-foreground"
								: "hover:text-foreground",
						)}
						onClick={() => setTab(k)}
						data-testid={`tab-${k}`}
					>
						{t(`game.${k}`)}
						{k === "chat" && unread > 0 && tab !== "chat" && (
							<span className="ms-1 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
								{unread}
							</span>
						)}
					</button>
				))}
			</div>
			{tab === "feed" ? <Feed view={view} /> : <Chat view={view} code={code} />}
		</section>
	);
}

function Feed({ view }: { view: GameView }) {
	const { t } = useTranslation();
	const bidi = useBidi(view);
	const text = useFeedText(view);
	const end = useRef<HTMLDivElement>(null);
	const pub = view.public;
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll when new entries arrive
	useEffect(
		() => end.current?.scrollIntoView({ block: "nearest" }),
		[pub.feed.length, pub.publicMessages.length],
	);
	// Public Oracle statements (Whisper, Mercy) go right after that round's threat announcement.
	const items: Array<{
		key: string;
		text: string;
		oracle?: boolean;
		round: number;
	}> = [];
	pub.feed.forEach((f, i) => {
		const s = text(f);
		if (s) items.push({ key: `f${i}`, text: s, round: f.round });
		if (f.kind === "threat") {
			for (const m of pub.publicMessages.filter((x) => x.round === f.round)) {
				items.push({ key: m.id, text: m.text, oracle: true, round: m.round });
			}
		}
	});
	return (
		<div
			className="max-h-96 flex-1 space-y-1 overflow-y-auto p-3 text-sm"
			data-testid="feed"
		>
			{items.map((it) =>
				it.oracle ? (
					<p
						key={it.key}
						className="transmission my-2 p-2.5"
						data-testid="oracle-public"
					>
						<span className="display me-1 font-semibold text-oracle">
							{t("game.oracleSays")}
						</span>
						<bdi {...bidi(it.text)} />
					</p>
				) : (
					<p
						key={it.key}
						className="flex gap-2 text-muted-foreground before:mt-2 before:size-1 before:shrink-0 before:rounded-full before:bg-border"
					>
						{it.text}
					</p>
				),
			)}
			<div ref={end} />
		</div>
	);
}

function Chat({ view, code }: { view: GameView; code: string }) {
	const { t } = useTranslation();
	const name = useNames(view);
	const bidi = useBidi(view);
	const [text, setText] = useState("");
	const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
	const [flash, setFlash] = useState<string | null>(null);
	const end = useRef<HTMLDivElement>(null);
	const input = useRef<HTMLInputElement>(null);
	const send = useMutation(
		orpc.game.chat.mutationOptions({
			onSuccess: () => {
				setText("");
				setReplyTo(null);
			},
			onError: (e) => toast.error(errorText(e)),
		}),
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll when new messages arrive
	useEffect(
		() => end.current?.scrollIntoView({ block: "nearest" }),
		[view.chat.length],
	);
	useEffect(() => {
		if (!flash) return;
		const id = setTimeout(() => setFlash(null), 1600);
		return () => clearTimeout(id);
	}, [flash]);
	const startReply = (c: ChatMessage) => {
		setReplyTo(c);
		input.current?.focus();
	};
	const jumpTo = (id: string) => {
		const el = document.getElementById(`chat-${id}`);
		if (!el) return;
		el.scrollIntoView({ block: "center", behavior: "smooth" });
		setFlash(id);
	};
	const shown = new Set(view.chat.map((c) => c.id));
	return (
		<div className="flex flex-1 flex-col">
			<div
				className="max-h-80 flex-1 space-y-2 overflow-y-auto p-3 text-sm"
				data-testid="chat"
			>
				{view.chat.length === 0 && (
					<p className="text-muted-foreground">{t("game.noChat")}</p>
				)}
				{view.chat.map((c) => {
					const mine = c.playerId === view.me?.playerId;
					return (
						<div
							key={c.id}
							id={`chat-${c.id}`}
							data-testid={`chat-${c.id}`}
							className={cn(
								"group flex max-w-[85%] flex-col gap-0.5",
								mine ? "ms-auto items-end" : "items-start",
							)}
						>
							<span className="px-1 text-[11px] text-muted-foreground">
								{name(c.playerId)}
							</span>
							<div
								className={cn(
									"flex items-center gap-1",
									mine && "flex-row-reverse",
								)}
							>
								<div
									className={cn(
										"rounded-lg px-3 py-1.5 transition-shadow",
										mine
											? "rounded-ee-sm bg-primary text-primary-foreground"
											: "rounded-es-sm bg-muted",
										flash === c.id && "ring-2 ring-oracle",
									)}
								>
									{c.replyTo && (
										<Quote
											quote={c.replyTo}
											author={name(c.replyTo.playerId)}
											bidi={bidi}
											mine={mine}
											onClick={
												shown.has(c.replyTo.id)
													? () => c.replyTo && jumpTo(c.replyTo.id)
													: undefined
											}
										/>
									)}
									<span {...bidi(c.text)} className="block" />
								</div>
								{view.me && (
									<button
										type="button"
										className="shrink-0 rounded-full p-1 text-muted-foreground opacity-60 transition hover:bg-muted hover:opacity-100 focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
										aria-label={t("game.replyTo", { p: name(c.playerId) })}
										title={t("game.reply")}
										onClick={() => startReply(c)}
										data-testid={`reply-${c.id}`}
									>
										<Reply className="size-3.5 rtl:-scale-x-100" />
									</button>
								)}
							</div>
						</div>
					);
				})}
				<div ref={end} />
			</div>
			{view.me && (
				<form
					className="space-y-2 border-t p-2"
					onSubmit={(e) => {
						e.preventDefault();
						if (text.trim())
							send.mutate({ code, text, replyTo: replyTo?.id ?? null });
					}}
				>
					{replyTo && (
						<div
							className="flex items-start gap-2 border-oracle border-s-2 bg-muted/60 px-2 py-1 text-xs"
							data-testid="replying-to"
						>
							<div className="min-w-0 flex-1">
								<div className="font-medium text-oracle">
									{t("game.replyingTo", { p: name(replyTo.playerId) })}
								</div>
								<div
									{...bidi(replyTo.text)}
									className="truncate text-muted-foreground"
								/>
							</div>
							<button
								type="button"
								className="rounded p-0.5 text-muted-foreground hover:text-foreground"
								aria-label={t("game.cancelReply")}
								onClick={() => setReplyTo(null)}
							>
								<X className="size-3.5" />
							</button>
						</div>
					)}
					<div className="flex gap-2">
						<Input
							ref={input}
							value={text}
							maxLength={300}
							dir="auto"
							placeholder={t("game.chatPlaceholder")}
							aria-label={t("game.chatPlaceholder")}
							onChange={(e) => setText(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Escape") setReplyTo(null);
							}}
							data-testid="chat-input"
						/>
						<Button type="submit" disabled={send.isPending || !text.trim()}>
							{t("game.send")}
						</Button>
					</div>
				</form>
			)}
		</div>
	);
}

/** The replied-to line, shown small at the top of a reply. */
function Quote({
	quote,
	author,
	bidi,
	mine,
	onClick,
}: {
	quote: ChatQuote;
	author: string;
	bidi: ReturnType<typeof useBidi>;
	mine: boolean;
	onClick?: () => void;
}) {
	const body = (
		<>
			<span className="block font-medium opacity-90">{author}</span>
			<span {...bidi(quote.text)} className="line-clamp-2 block opacity-80" />
		</>
	);
	const cls = cn(
		"mb-1 block w-full rounded border-s-2 px-2 py-0.5 text-start text-[12px]",
		mine
			? "border-primary-foreground/60 bg-primary-foreground/15"
			: "border-oracle bg-background/50",
	);
	return onClick ? (
		<button
			type="button"
			className={cn(cls, "cursor-pointer hover:brightness-110")}
			onClick={onClick}
			data-testid="chat-quote"
		>
			{body}
		</button>
	) : (
		<span className={cls} data-testid="chat-quote">
			{body}
		</span>
	);
}

export function Pile({ view, code }: { view: GameView; code: string }) {
	const { t } = useTranslation();
	const { canScan, scan } = useScanner(view, code);
	const pub = view.public;
	return (
		<Section
			title={`${t("game.pile")}${pub.pileRound ? ` · ${t("game.round", { n: pub.pileRound })}` : ""}`}
			testId="pile"
		>
			{pub.pile.length === 0 ? (
				<p className="text-muted-foreground text-sm">{t("game.pileEmpty")}</p>
			) : (
				<>
					{canScan && (
						<p className="text-primary text-xs">{t("game.scanHint")}</p>
					)}
					<div className="flex flex-wrap gap-1.5">
						{pub.pile.map((c, i) => (
							<CardFace
								key={c.id}
								card={c}
								small
								onClick={canScan ? () => scan(i) : undefined}
								testId={`pile-${i}`}
							/>
						))}
					</div>
				</>
			)}
		</Section>
	);
}
