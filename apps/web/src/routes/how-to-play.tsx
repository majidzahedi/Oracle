import { ACTION_KINDS } from "@oracle/engine";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { CardFace } from "@/components/game/common";

export const Route = createFileRoute("/how-to-play")({
	component: HowToPlay,
});

function HowToPlay() {
	const { t } = useTranslation();
	const phases = ["night", "day", "action", "resolution", "vote"] as const;
	return (
		<main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 leading-relaxed">
			<h1 className="font-bold text-3xl">{t("howTo.title")}</h1>
			<p>{t("howTo.premise")}</p>
			<Block title={t("howTo.boardTitle")}>{t("howTo.board")}</Block>
			<Block title={t("howTo.roundTitle")}>
				<ol className="list-decimal space-y-1 ps-5">
					{phases.map((p) => (
						<li key={p}>{t(`howTo.${p}`)}</li>
					))}
				</ol>
			</Block>
			<Block title={t("howTo.pactTitle")}>{t("howTo.pact")}</Block>
			<Block title={t("howTo.cardsTitle")}>
				<ul className="space-y-2">
					{ACTION_KINDS.map((a) => (
						<li key={a} className="flex items-center gap-3">
							<CardFace card={{ id: a, kind: "action", action: a }} small />
							<span>{t(`game.actionHelp.${a}`)}</span>
						</li>
					))}
				</ul>
			</Block>
			<Block title={t("howTo.threatsTitle")}>{t("howTo.threats")}</Block>
			<Block title={t("howTo.endTitle")}>{t("howTo.end")}</Block>
			<Block title={t("howTo.rulesTitle")}>{t("howTo.rules")}</Block>
		</main>
	);
}

function Block({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section className="space-y-2">
			<h2 className="font-semibold text-xl">{title}</h2>
			<div>{children}</div>
		</section>
	);
}
