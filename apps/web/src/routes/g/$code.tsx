import { GAME_TOPICS, gameChannel } from "@oracle/realtime";
import { Button } from "@oracle/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@oracle/ui/components/card";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useRealtime } from "inngest/react";
import { Bot, Copy, Crown, User } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { GameScreen } from "@/components/game/game-screen";
import GuestEntry from "@/components/guest-entry";
import Loader from "@/components/loader";
import { errorText } from "@/i18n";
import { authClient } from "@/lib/auth-client";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/g/$code")({
	component: GameRoute,
});

function GameRoute() {
	const { code } = Route.useParams();
	const { data: session, isPending } = authClient.useSession();
	if (isPending) return <Loader />;
	return (
		<main className="mx-auto w-full max-w-5xl px-4 py-4">
			{session ? <Lobby code={code.toUpperCase()} /> : <GuestEntry />}
		</main>
	);
}

type LobbyView = Awaited<ReturnType<typeof client.lobby.get>>;

function Lobby({ code }: { code: string }) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const lobbyQuery = orpc.lobby.get.queryOptions({ input: { code } });
	const lobby = useQuery({
		...lobbyQuery,
		retry: false,
		refetchInterval: 15_000,
	});
	const gameId = lobby.data?.id;

	// Live updates: the public channel only says "something changed"; we refetch our own view.
	const live = useRealtime({
		channel: gameChannel({ gameId: gameId ?? "pending" }),
		topics: GAME_TOPICS,
		token: () => client.realtime.gameToken({ code }),
		enabled: Boolean(gameId),
		pauseOnHidden: false,
	});
	const lastVersion = live.messages.byTopic.lobby?.data.version;
	useEffect(() => {
		if (lastVersion !== undefined)
			void queryClient.invalidateQueries({ queryKey: lobbyQuery.queryKey });
	}, [lastVersion, queryClient, lobbyQuery.queryKey]);
	useEffect(() => {
		// Catch up on anything missed while disconnected.
		if (live.connectionStatus === "open")
			void queryClient.invalidateQueries({ queryKey: lobbyQuery.queryKey });
	}, [live.connectionStatus, queryClient, lobbyQuery.queryKey]);

	const opts = {
		onSuccess: (data: LobbyView) =>
			queryClient.setQueryData(lobbyQuery.queryKey, data),
		onError: (e: unknown) => toast.error(errorText(e)),
	};
	const takeSeat = useMutation(orpc.lobby.takeSeat.mutationOptions(opts));
	const leaveSeat = useMutation(orpc.lobby.leaveSeat.mutationOptions(opts));
	const addBot = useMutation(orpc.lobby.addBot.mutationOptions(opts));
	const clearSeat = useMutation(orpc.lobby.clearSeat.mutationOptions(opts));
	const fillBots = useMutation(orpc.lobby.fillBots.mutationOptions(opts));
	const start = useMutation(orpc.lobby.start.mutationOptions(opts));
	const busy = [takeSeat, leaveSeat, addBot, clearSeat, fillBots, start].some(
		(m) => m.isPending,
	);

	if (lobby.isPending) return <Loader />;
	if (lobby.error || !lobby.data) {
		return (
			<div className="space-y-4 text-center">
				<p>{errorText(lobby.error)}</p>
				<Link to="/">
					<Button variant="outline">{t("lobby.back")}</Button>
				</Link>
			</div>
		);
	}

	const view = lobby.data;
	if (view.status !== "lobby")
		return <GameScreen code={code} gameId={view.id} />;
	const full = view.seats.every((s) => s.occupied);

	const copyLink = async () => {
		await navigator.clipboard.writeText(window.location.href);
		toast.success(t("lobby.copied"));
	};

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="font-bold text-2xl">{t("lobby.title")}</h1>
					<p className="text-muted-foreground text-sm">
						{t("lobby.code")}:{" "}
						<span
							className="font-mono text-foreground text-lg tracking-widest"
							dir="ltr"
							data-testid="game-code"
						>
							{view.code}
						</span>
					</p>
				</div>
				<div className="flex items-center gap-2">
					<span
						className={`inline-flex items-center gap-1 text-xs ${live.connectionStatus === "open" ? "text-green-500" : "text-muted-foreground"}`}
						data-testid="live-status"
						data-status={live.connectionStatus}
					>
						<span className="size-2 rounded-full bg-current" />
						{live.connectionStatus === "open"
							? t("lobby.live")
							: t("lobby.connecting")}
					</span>
					<Button variant="outline" size="sm" onClick={copyLink}>
						<Copy />
						{t("lobby.copyLink")}
					</Button>
				</div>
			</div>

			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				{view.seats.map((s) => (
					<Card
						key={s.seat}
						data-testid={`seat-${s.seat}`}
						className={s.isMe ? "ring-2 ring-primary" : undefined}
					>
						<CardHeader>
							<CardTitle className="flex items-center justify-between text-sm">
								<span className="text-muted-foreground">
									{t("lobby.seat", { n: s.seat + 1 })}
								</span>
								<span className="flex gap-1">
									{s.isHost && (
										<span className="inline-flex items-center gap-1 text-amber-500 text-xs">
											<Crown className="size-3" />
											{t("lobby.host")}
										</span>
									)}
									{s.isMe && (
										<span className="text-primary text-xs">
											{t("lobby.you")}
										</span>
									)}
								</span>
							</CardTitle>
						</CardHeader>
						<CardContent className="space-y-3">
							<div className="flex min-h-7 items-center gap-2 font-medium text-lg">
								{s.occupied ? (
									<>
										{s.isBot ? (
											<Bot className="size-5" />
										) : (
											<User className="size-5" />
										)}
										<span data-testid={`seat-${s.seat}-name`}>
											{s.isBot ? t("lobby.botName", { n: s.seat + 1 }) : s.name}
										</span>
									</>
								) : (
									<span className="text-muted-foreground">
										{t("lobby.empty")}
									</span>
								)}
							</div>
							<div className="flex flex-wrap gap-2">
								{!s.occupied && (
									<Button
										size="sm"
										disabled={busy}
										onClick={() => takeSeat.mutate({ code, seat: s.seat })}
									>
										{view.mySeat === null
											? t("lobby.sitHere")
											: t("lobby.moveHere")}
									</Button>
								)}
								{!s.occupied && view.isHost && (
									<Button
										size="sm"
										variant="outline"
										disabled={busy}
										onClick={() => addBot.mutate({ code, seat: s.seat })}
									>
										<Bot />
										{t("lobby.addBot")}
									</Button>
								)}
								{s.isMe && (
									<Button
										size="sm"
										variant="outline"
										disabled={busy}
										onClick={() => leaveSeat.mutate({ code })}
									>
										{t("lobby.leave")}
									</Button>
								)}
								{s.occupied && !s.isMe && view.isHost && (
									<Button
										size="sm"
										variant="destructive"
										disabled={busy}
										onClick={() => clearSeat.mutate({ code, seat: s.seat })}
									>
										{t("lobby.remove")}
									</Button>
								)}
							</div>
						</CardContent>
					</Card>
				))}
			</div>

			<div className="space-y-3">
				{view.isHost ? (
					<div className="flex flex-col gap-2 sm:flex-row">
						<Button
							variant="outline"
							size="lg"
							disabled={busy || full}
							onClick={() => fillBots.mutate({ code })}
						>
							<Bot />
							{t("lobby.fillBots")}
						</Button>
						<Button
							size="lg"
							disabled={busy || !full}
							onClick={() => start.mutate({ code })}
						>
							{t("lobby.start")}
						</Button>
					</div>
				) : (
					<p className="text-muted-foreground text-sm">
						{t("lobby.waitingHost")}
					</p>
				)}
				{!full && (
					<p className="text-muted-foreground text-xs">{t("lobby.needFour")}</p>
				)}
				{view.mySeat === null && (
					<p className="text-sm">{t("lobby.notSeated")}</p>
				)}
			</div>
			<OraclePicker code={code} view={view} />
		</div>
	);
}

/** The host chooses who speaks as the Oracle; everyone else sees the choice. */
function OraclePicker({ code, view }: { code: string; view: LobbyView }) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const options = useQuery({
		...orpc.lobby.oracleOptions.queryOptions(),
		enabled: view.isHost,
	});
	const setOracle = useMutation(
		orpc.lobby.setOracle.mutationOptions({
			onSuccess: (data) =>
				queryClient.setQueryData(
					orpc.lobby.get.queryOptions({ input: { code } }).queryKey,
					data,
				),
			onError: (e) => toast.error(errorText(e)),
		}),
	);
	const def = options.data?.find((o) => o.isDefault);
	const label = (choice: string, name: string | null) =>
		choice === "scripted"
			? t("oracle.scripted")
			: choice === "default"
				? def
					? t("oracle.defaultNamed", { name: `${def.name} · ${def.model}` })
					: t("oracle.default")
				: (name ?? choice);
	return (
		<div
			className="flex flex-wrap items-center gap-2 border-t pt-3 text-sm"
			data-testid="oracle-picker"
		>
			<label htmlFor="oracle-choice" className="text-muted-foreground">
				{t("oracle.label")}
			</label>
			{view.isHost ? (
				<select
					id="oracle-choice"
					className="h-8 border bg-background px-2"
					value={view.oracle.choice}
					disabled={setOracle.isPending}
					onChange={(e) => setOracle.mutate({ code, choice: e.target.value })}
				>
					<option value="default">{label("default", null)}</option>
					<option value="scripted">{t("oracle.scripted")}</option>
					{options.data
						?.filter((o) => !o.isDefault)
						.map((o) => (
							<option key={o.id} value={o.id}>
								{o.name} · {o.model}
							</option>
						))}
				</select>
			) : (
				<span id="oracle-choice">
					{label(view.oracle.choice, view.oracle.name)}
				</span>
			)}
		</div>
	);
}
