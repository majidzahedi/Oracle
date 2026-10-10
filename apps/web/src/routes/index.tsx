import { Button } from "@oracle/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@oracle/ui/components/card";
import { Input } from "@oracle/ui/components/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import GuestEntry from "@/components/guest-entry";
import Loader from "@/components/loader";
import { OracleEye } from "@/components/oracle-eye";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/")({
	component: HomeComponent,
});

function HomeComponent() {
	const { t } = useTranslation();
	const { data: session, isPending } = authClient.useSession();

	return (
		<main className="mx-auto w-full max-w-3xl space-y-10 px-4 py-10">
			<section className="flex flex-col items-center gap-4 text-center">
				<OracleEye className="h-20 w-32" />
				<h1 className="display bg-gradient-to-b from-foreground to-primary bg-clip-text font-bold text-5xl text-transparent">
					{t("app.title")}
				</h1>
				<p className="max-w-md text-muted-foreground">{t("app.tagline")}</p>
				<div className="flex flex-wrap justify-center gap-2 font-mono text-[11px] text-muted-foreground uppercase">
					<span className="border px-2 py-0.5">
						4 · {t("home.chipPrisoners")}
					</span>
					<span className="border px-2 py-0.5">4 · {t("home.chipLocks")}</span>
					<span className="border border-alarm/50 px-2 py-0.5 text-alarm">
						12 · {t("game.lockdown")}
					</span>
				</div>
			</section>
			{isPending ? <Loader /> : session ? <Play /> : <GuestEntry />}
		</main>
	);
}

function Play() {
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const [code, setCode] = useState("");
	const mine = useQuery(orpc.lobby.mine.queryOptions());
	const create = useMutation(
		orpc.lobby.create.mutationOptions({
			onSuccess: ({ code }) => navigate({ to: "/g/$code", params: { code } }),
		}),
	);
	const cleaned = code.trim().toUpperCase();

	return (
		<div className="space-y-6">
			<div className="grid gap-4 sm:grid-cols-2">
				<Card className="panel overflow-visible ring-0">
					<CardHeader>
						<CardTitle className="panel-title">{t("home.create")}</CardTitle>
					</CardHeader>
					<CardContent>
						<Button
							size="lg"
							className="w-full"
							disabled={create.isPending}
							onClick={() =>
								create.mutate({
									language: i18n.language === "en" ? "en" : "fa",
								})
							}
						>
							{t("home.create")}
						</Button>
					</CardContent>
				</Card>
				<Card className="panel overflow-visible ring-0">
					<CardHeader>
						<CardTitle className="panel-title">{t("home.joinTitle")}</CardTitle>
					</CardHeader>
					<CardContent>
						<form
							className="flex gap-2"
							onSubmit={(e) => {
								e.preventDefault();
								if (cleaned)
									navigate({ to: "/g/$code", params: { code: cleaned } });
							}}
						>
							<Input
								aria-label={t("home.codePlaceholder")}
								placeholder={t("home.codePlaceholder")}
								value={code}
								maxLength={12}
								dir="ltr"
								className="font-mono uppercase tracking-widest"
								onChange={(e) => setCode(e.target.value)}
							/>
							<Button type="submit" size="lg" disabled={!cleaned}>
								{t("home.join")}
							</Button>
						</form>
					</CardContent>
				</Card>
			</div>

			{mine.data && mine.data.length > 0 && (
				<section className="space-y-2">
					<h2 className="panel-title">{t("home.myGames")}</h2>
					<ul className="panel divide-y">
						{mine.data.map((g) => (
							<li
								key={g.code}
								className="flex items-center justify-between gap-2 px-3 py-2"
							>
								<span className="font-mono tracking-widest" dir="ltr">
									{g.code}
								</span>
								<span className="text-muted-foreground text-xs">
									{t(
										`home.status.${g.status as "lobby" | "active" | "finished"}`,
									)}{" "}
									· {t("home.seat", { n: g.seat + 1 })}
								</span>
								<Link to="/g/$code" params={{ code: g.code }}>
									<Button variant="outline" size="sm">
										{t("home.open")}
									</Button>
								</Link>
							</li>
						))}
					</ul>
				</section>
			)}
		</div>
	);
}
