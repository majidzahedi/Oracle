import type { FeedEntry } from "@oracle/engine";
import type { GameView } from "@oracle/realtime";
import { Button } from "@oracle/ui/components/button";
import { Input } from "@oracle/ui/components/input";
import { cn } from "@oracle/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
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
	const end = useRef<HTMLDivElement>(null);
	const send = useMutation(
		orpc.game.chat.mutationOptions({
			onSuccess: () => setText(""),
			onError: (e) => toast.error(errorText(e)),
		}),
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll when new messages arrive
	useEffect(
		() => end.current?.scrollIntoView({ block: "nearest" }),
		[view.chat.length],
	);
	return (
		<div className="flex flex-1 flex-col">
			<div
				className="max-h-80 flex-1 space-y-2 overflow-y-auto p-3 text-sm"
				data-testid="chat"
			>
				{view.chat.length === 0 && (
					<p className="text-muted-foreground">{t("game.noChat")}</p>
				)}
				{view.chat.map((c) => (
					<div
						key={c.id}
						className={cn(
							"flex max-w-[85%] flex-col gap-0.5",
							c.playerId === view.me?.playerId
								? "ms-auto items-end"
								: "items-start",
						)}
					>
						<span className="px-1 text-[11px] text-muted-foreground">
							{name(c.playerId)}
						</span>
						<span
							{...bidi(c.text)}
							className={cn(
								"rounded-lg px-3 py-1.5",
								c.playerId === view.me?.playerId
									? "rounded-ee-sm bg-primary text-primary-foreground"
									: "rounded-es-sm bg-muted",
							)}
						/>
					</div>
				))}
				<div ref={end} />
			</div>
			{view.me && (
				<form
					className="flex gap-2 border-t p-2"
					onSubmit={(e) => {
						e.preventDefault();
						if (text.trim()) send.mutate({ code, text });
					}}
				>
					<Input
						value={text}
						maxLength={300}
						dir="auto"
						placeholder={t("game.chatPlaceholder")}
						aria-label={t("game.chatPlaceholder")}
						onChange={(e) => setText(e.target.value)}
						data-testid="chat-input"
					/>
					<Button type="submit" disabled={send.isPending || !text.trim()}>
						{t("game.send")}
					</Button>
				</form>
			)}
		</div>
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
