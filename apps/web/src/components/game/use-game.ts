import {
	GAME_TOPICS,
	type GameView,
	gameChannel,
	PLAYER_TOPICS,
	playerChannel,
} from "@oracle/realtime";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRealtime } from "inngest/react";
import { useEffect } from "react";

import { client, orpc } from "@/utils/orpc";

/**
 * Game state for this tab: fetched once, then kept live by two Realtime
 * subscriptions (public table channel + this player's private channel). Every
 * reconnect refetches, so nothing missed while offline is lost.
 */
export function useGame(code: string, gameId: string | undefined) {
	const queryClient = useQueryClient();
	const viewQuery = orpc.game.view.queryOptions({ input: { code } });
	const view = useQuery({
		...viewQuery,
		enabled: Boolean(gameId),
		retry: 1,
		refetchInterval: 30_000,
	});
	const seated = Boolean(view.data?.me);

	// Private channel names use the seat row id, which the token endpoint returns after an ownership check.
	const privateToken = useQuery({
		queryKey: ["playerToken", code],
		queryFn: () => client.realtime.playerToken({ code }),
		enabled: seated,
		staleTime: Number.POSITIVE_INFINITY,
	});

	const pub = useRealtime({
		channel: gameChannel({ gameId: gameId ?? "none" }),
		topics: GAME_TOPICS,
		token: () => client.realtime.gameToken({ code }),
		enabled: Boolean(gameId),
		pauseOnHidden: false,
		bufferInterval: 0,
	});
	const priv = useRealtime({
		channel: playerChannel({
			gameId: gameId ?? "none",
			playerId: privateToken.data?.playerId ?? "none",
		}),
		topics: PLAYER_TOPICS,
		token: async () => {
			const t = await client.realtime.playerToken({ code });
			return { key: t.key, apiBaseUrl: t.apiBaseUrl };
		},
		enabled: Boolean(gameId && privateToken.data),
		pauseOnHidden: false,
		bufferInterval: 0,
	});

	const update = (fn: (v: GameView) => GameView) =>
		queryClient.setQueryData<GameView>(viewQuery.queryKey, (v) =>
			v ? fn(v) : v,
		);

	// biome-ignore lint/correctness/useExhaustiveDependencies: react to new message batches only
	useEffect(() => {
		for (const m of pub.messages.delta) {
			if (m.topic === "state") {
				const next = m.data as GameView["public"];
				update((v) =>
					next.version >= v.public.version ? { ...v, public: next } : v,
				);
			} else if (m.topic === "chat") {
				const msg = m.data as GameView["chat"][number];
				update((v) =>
					v.chat.some((c) => c.id === msg.id)
						? v
						: { ...v, chat: [...v.chat, msg] },
				);
			} else if (m.topic === "lobby") {
				void queryClient.invalidateQueries({ queryKey: viewQuery.queryKey });
			}
		}
	}, [pub.messages.delta]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: react to new message batches only
	useEffect(() => {
		for (const m of priv.messages.delta) {
			if (m.topic === "me")
				update((v) => ({ ...v, me: m.data as GameView["me"] }));
		}
	}, [priv.messages.delta]);

	useEffect(() => {
		if (pub.connectionStatus === "open" || priv.connectionStatus === "open") {
			void queryClient.invalidateQueries({ queryKey: viewQuery.queryKey });
		}
	}, [
		pub.connectionStatus,
		priv.connectionStatus,
		queryClient,
		viewQuery.queryKey,
	]);

	const live =
		pub.connectionStatus === "open" &&
		(!seated || priv.connectionStatus === "open");
	return {
		view,
		live,
		refetch: () =>
			queryClient.invalidateQueries({ queryKey: viewQuery.queryKey }),
	};
}
