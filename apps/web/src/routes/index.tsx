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
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/")({
	component: HomeComponent,
});

function HomeComponent() {
	const { t } = useTranslation();
	const { data: session, isPending } = authClient.useSession();

	return (
		<main className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8">
			<section className="space-y-2 text-center">
				<h1 className="font-bold text-4xl tracking-tight">{t("app.title")}</h1>
				<p className="text-muted-foreground">{t("app.tagline")}</p>
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
				<Card>
					<CardHeader>
						<CardTitle>{t("home.create")}</CardTitle>
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
				<Card>
					<CardHeader>
						<CardTitle>{t("home.joinTitle")}</CardTitle>
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
					<h2 className="font-medium">{t("home.myGames")}</h2>
					<ul className="divide-y border">
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
