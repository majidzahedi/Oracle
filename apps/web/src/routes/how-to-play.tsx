import { ACTION_KINDS } from "@oracle/engine";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { CardFace } from "@/components/game/common";
import { OracleEye } from "@/components/oracle-eye";

export const Route = createFileRoute("/how-to-play")({
	component: HowToPlay,
});

function HowToPlay() {
	const { t } = useTranslation();
	const phases = ["night", "day", "action", "resolution", "vote"] as const;
	return (
		<main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 leading-relaxed">
			<div className="flex items-center gap-3">
				<OracleEye className="h-10 w-16" />
				<h1 className="display font-bold text-3xl">{t("howTo.title")}</h1>
			</div>
			<p className="text-lg text-muted-foreground">{t("howTo.premise")}</p>
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
		<section className="panel space-y-2 p-4">
			<h2 className="display font-semibold text-primary text-xl">{title}</h2>
			<div>{children}</div>
		</section>
	);
}
