import { useTranslation } from "react-i18next";

import Loader from "@/components/loader";
import { errorText } from "@/i18n";

import { PhaseBar, PlayersList, SectorBoard } from "./board";
import { EndScreen } from "./end-screen";
import { FeedAndChat, Pile } from "./feed";
import { HandPanel, PhaseControls, SecretsPanel } from "./play-panel";
import { useGame } from "./use-game";

export function GameScreen({ code, gameId }: { code: string; gameId: string }) {
	const { t } = useTranslation();
	const { view, live } = useGame(code, gameId);
	if (view.isPending) return <Loader />;
	if (!view.data) return <p className="text-center">{errorText(view.error)}</p>;
	const v = view.data;
	const finished = v.public.status === "finished";

	return (
		<div className="space-y-3" data-testid="game-screen">
			{!live && !finished && (
				<p
					className="border border-amber-500/50 bg-amber-500/10 p-2 text-center text-xs"
					data-testid="reconnecting"
				>
					{t("game.connecting")}
				</p>
			)}
			<PhaseBar view={v.public} />
			{finished && <EndScreen view={v} />}
			<div className="grid gap-3 lg:grid-cols-2 lg:items-start">
				<div className="space-y-3">
					{v.me && <PhaseControls view={v} me={v.me} code={code} />}
					{v.me && <SecretsPanel view={v} me={v.me} />}
					<SectorBoard view={v.public} />
					{v.me && <HandPanel view={v} me={v.me} code={code} />}
					<Pile view={v} code={code} />
				</div>
				<div className="space-y-3">
					<PlayersList view={v} me={v.me?.playerId} />
					<FeedAndChat view={v} code={code} />
				</div>
			</div>
		</div>
	);
}
