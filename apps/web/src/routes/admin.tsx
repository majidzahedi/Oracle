import { Button } from "@oracle/ui/components/button";
import { Input } from "@oracle/ui/components/input";
import { Label } from "@oracle/ui/components/label";
import { cn } from "@oracle/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import Loader from "@/components/loader";
import { errorText } from "@/i18n";
import { authClient } from "@/lib/auth-client";
import { type client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/admin")({
	component: AdminRoute,
});

type Profile = Awaited<ReturnType<typeof client.admin.profiles.list>>[number];
type ProfileData = Parameters<typeof client.admin.profiles.create>[0];
const PROVIDERS = [
	"ollama",
	"openai-compatible",
	"anthropic",
	"openai",
	"google",
	"laya",
] as const;
const isDecisionEngine = (provider: string) => provider === "laya";
const BASE_URL_PLACEHOLDER: Record<(typeof PROVIDERS)[number], string> = {
	ollama: "http://localhost:11434/v1",
	"openai-compatible": "http://localhost:1234/v1",
	anthropic: "https://api.anthropic.com/v1",
	openai: "https://api.openai.com/v1",
	google: "https://generativelanguage.googleapis.com/v1beta",
	laya: "http://localhost:8000",
};

function AdminRoute() {
	const { t } = useTranslation();
	const { data: session, isPending } = authClient.useSession();
	const me = useQuery({
		...orpc.admin.me.queryOptions(),
		enabled: Boolean(session),
	});
	if (isPending || (session && me.isPending)) return <Loader />;
	if (!me.data?.isAdmin) {
		return (
			<main className="mx-auto max-w-3xl px-4 py-8">
				<p data-testid="not-admin">{t("admin.notAdmin")}</p>
			</main>
		);
	}
	return (
		<main className="mx-auto w-full max-w-4xl space-y-8 px-4 py-6">
			<h1 className="font-bold text-2xl">{t("admin.title")}</h1>
			<Profiles />
			<Calls />
		</main>
	);
}

function Profiles() {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const list = useQuery(orpc.admin.profiles.list.queryOptions());
	const [editing, setEditing] = useState<Profile | "new" | null>(null);
	const refresh = () =>
		queryClient.invalidateQueries({ queryKey: orpc.admin.profiles.list.key() });
	const onError = (e: unknown) => toast.error(errorText(e));
	const setDefault = useMutation(
		orpc.admin.profiles.setDefault.mutationOptions({
			onSuccess: refresh,
			onError,
		}),
	);
	const remove = useMutation(
		orpc.admin.profiles.remove.mutationOptions({ onSuccess: refresh, onError }),
	);
	const setDecider = useMutation(
		orpc.admin.profiles.setDecider.mutationOptions({
			onSuccess: refresh,
			onError,
		}),
	);

	return (
		<section className="space-y-3">
			<div className="flex flex-wrap items-end justify-between gap-2">
				<div>
					<h2 className="font-semibold text-lg">{t("admin.profiles")}</h2>
					<p className="text-muted-foreground text-sm">
						{t("admin.profilesHint")}
					</p>
				</div>
				<Button onClick={() => setEditing("new")} data-testid="new-profile">
					{t("admin.newProfile")}
				</Button>
			</div>
			{editing && (
				<ProfileForm
					profile={editing === "new" ? null : editing}
					onDone={() => {
						setEditing(null);
						void refresh();
					}}
				/>
			)}
			{list.data?.length === 0 && (
				<p className="text-muted-foreground text-sm">{t("admin.empty")}</p>
			)}
			<ul className="space-y-2">
				{list.data?.map((p) => (
					<ProfileCard
						key={p.id}
						profile={p}
						onEdit={() => setEditing(p)}
						onDefault={() => setDefault.mutate({ id: p.id })}
						onDecider={() => setDecider.mutate({ id: p.id })}
						onDelete={() => {
							if (window.confirm(t("admin.confirmDelete")))
								remove.mutate({ id: p.id });
						}}
					/>
				))}
			</ul>
			{list.data?.some((p) => p.isDefault) && (
				<Button
					variant="ghost"
					size="sm"
					onClick={() => setDefault.mutate({ id: null })}
				>
					{t("admin.noDefault")}
				</Button>
			)}
			{list.data?.some((p) => p.isDecider) && (
				<Button
					variant="ghost"
					size="sm"
					onClick={() => setDecider.mutate({ id: null })}
				>
					{t("admin.noDecider")}
				</Button>
			)}
			<p className="text-muted-foreground text-xs">{t("admin.deciderHint")}</p>
		</section>
	);
}

function ProfileCard({
	profile: p,
	onEdit,
	onDefault,
	onDecider,
	onDelete,
}: {
	profile: Profile;
	onEdit: () => void;
	onDefault: () => void;
	onDecider: () => void;
	onDelete: () => void;
}) {
	const { t } = useTranslation();
	const test = useMutation(
		orpc.admin.profiles.test.mutationOptions({
			onError: (e) => toast.error(errorText(e)),
		}),
	);
	return (
		<li
			className={cn(
				"space-y-2 border bg-card p-3",
				(p.isDefault || p.isDecider) && "border-primary",
			)}
			data-testid={`profile-${p.name}`}
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="min-w-0">
					<div className="flex items-center gap-2 font-medium">
						{p.name}
						{p.isDefault && (
							<span className="bg-primary px-1.5 text-[10px] text-primary-foreground">
								{t("admin.isDefault")}
							</span>
						)}
						{p.isDecider && (
							<span className="bg-primary px-1.5 text-[10px] text-primary-foreground">
								{t("admin.isDecider")}
							</span>
						)}
						{!p.enabled && (
							<span className="border px-1.5 text-[10px] text-muted-foreground">
								{t("admin.disabled")}
							</span>
						)}
					</div>
					<div className="truncate text-muted-foreground text-xs" dir="ltr">
						{t(`admin.providers.${p.provider as "ollama"}`)} · {p.model}
						{p.baseUrl ? ` · ${p.baseUrl}` : ""} ·{" "}
						{p.hasApiKey
							? t("admin.keyStored", { hint: p.apiKeyHint })
							: t("admin.noKey")}
					</div>
				</div>
				<div className="flex flex-wrap gap-1">
					<Button
						size="sm"
						variant="outline"
						disabled={test.isPending}
						onClick={() => test.mutate({ id: p.id })}
						data-testid="test-profile"
					>
						{test.isPending ? t("admin.testing") : t("admin.test")}
					</Button>
					{!isDecisionEngine(p.provider) && !p.isDefault && p.enabled && (
						<Button
							size="sm"
							variant="outline"
							onClick={onDefault}
							data-testid="make-default"
						>
							{t("admin.makeDefault")}
						</Button>
					)}
					{isDecisionEngine(p.provider) && !p.isDecider && p.enabled && (
						<Button
							size="sm"
							variant="outline"
							onClick={onDecider}
							data-testid="make-decider"
						>
							{t("admin.useForDecisions")}
						</Button>
					)}
					<Button size="sm" variant="outline" onClick={onEdit}>
						{t("admin.edit")}
					</Button>
					<Button size="sm" variant="destructive" onClick={onDelete}>
						{t("admin.delete")}
					</Button>
				</div>
			</div>
			{test.data && (
				<p
					className={cn(
						"text-sm",
						test.data.ok
							? "text-green-600 dark:text-green-400"
							: "text-destructive",
					)}
					data-testid="test-result"
					dir="auto"
				>
					{test.data.ok
						? t("admin.testOk", {
								ms: test.data.latencyMs,
								sample: test.data.sample,
							})
						: t("admin.testFail", {
								ms: test.data.latencyMs,
								error: test.data.error,
							})}
				</p>
			)}
		</li>
	);
}

function ProfileForm({
	profile,
	onDone,
}: {
	profile: Profile | null;
	onDone: () => void;
}) {
	const { t } = useTranslation();
	const [form, setForm] = useState({
		name: profile?.name ?? "",
		provider: (profile?.provider ?? "ollama") as (typeof PROVIDERS)[number],
		model: profile?.model ?? "",
		baseUrl: profile?.baseUrl ?? "",
		apiKey: "",
		removeKey: false,
		temperature: profile?.temperature ?? 0.8,
		timeoutSec: Math.round((profile?.timeoutMs ?? 60000) / 1000),
		verifyClaims: profile?.verifyClaims ?? true,
		enabled: profile?.enabled ?? true,
	});
	const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
		setForm((f) => ({ ...f, [k]: v }));
	const onError = (e: unknown) => toast.error(errorText(e));
	const create = useMutation(
		orpc.admin.profiles.create.mutationOptions({ onSuccess: onDone, onError }),
	);
	const update = useMutation(
		orpc.admin.profiles.update.mutationOptions({ onSuccess: onDone, onError }),
	);
	const models = useMutation(
		orpc.admin.profiles.models.mutationOptions({ onError }),
	);

	const data = (): ProfileData => ({
		name: form.name,
		provider: form.provider,
		model: form.model,
		baseUrl: form.baseUrl.trim() || null,
		apiKey: form.removeKey
			? null
			: form.apiKey
				? form.apiKey
				: profile
					? undefined
					: null,
		temperature: Number(form.temperature),
		timeoutMs: Math.round(Number(form.timeoutSec) * 1000),
		verifyClaims: form.verifyClaims,
		enabled: form.enabled,
	});
	const save = () =>
		profile
			? update.mutate({ id: profile.id, data: data() })
			: create.mutate(data());
	const needsKey = !["ollama", "openai-compatible"].includes(form.provider);

	return (
		<form
			className="grid gap-3 border bg-card p-3 sm:grid-cols-2"
			data-testid="profile-form"
			onSubmit={(e) => {
				e.preventDefault();
				save();
			}}
		>
			<Field label={t("admin.field.name")} id="pf-name">
				<Input
					id="pf-name"
					value={form.name}
					onChange={(e) => set("name", e.target.value)}
					required
				/>
			</Field>
			<Field label={t("admin.field.provider")} id="pf-provider">
				<select
					id="pf-provider"
					className="h-8 w-full border bg-background px-2 text-sm"
					value={form.provider}
					onChange={(e) =>
						set("provider", e.target.value as (typeof PROVIDERS)[number])
					}
				>
					{PROVIDERS.map((p) => (
						<option key={p} value={p}>
							{t(`admin.providers.${p}`)}
						</option>
					))}
				</select>
			</Field>
			<Field
				label={t("admin.field.baseUrl")}
				id="pf-base"
				hint={t("admin.field.baseUrlHint")}
			>
				<Input
					id="pf-base"
					dir="ltr"
					placeholder={BASE_URL_PLACEHOLDER[form.provider]}
					value={form.baseUrl}
					onChange={(e) => set("baseUrl", e.target.value)}
				/>
			</Field>
			<Field label={t("admin.field.model")} id="pf-model">
				<div className="flex gap-1">
					<Input
						id="pf-model"
						dir="ltr"
						list="pf-models"
						value={form.model}
						onChange={(e) => set("model", e.target.value)}
						required
					/>
					<Button
						type="button"
						variant="outline"
						disabled={models.isPending}
						onClick={() =>
							models.mutate({
								provider: form.provider,
								baseUrl: form.baseUrl.trim() || null,
								apiKey: form.apiKey || null,
								profileId: profile?.id,
							})
						}
					>
						{t("admin.findModels")}
					</Button>
				</div>
				<datalist id="pf-models">
					{models.data?.models.map((m) => (
						<option key={m} value={m} />
					))}
				</datalist>
				{models.data && (
					<p
						className={cn(
							"text-xs",
							models.data.error ? "text-destructive" : "text-muted-foreground",
						)}
					>
						{models.data.error ??
							t("admin.modelsFound", { count: models.data.models.length })}
					</p>
				)}
			</Field>
			<Field label={t("admin.field.apiKey")} id="pf-key">
				<Input
					id="pf-key"
					type="password"
					autoComplete="off"
					dir="ltr"
					placeholder={
						profile?.hasApiKey
							? `••••${profile.apiKeyHint} — ${t("admin.field.apiKeyKeep")}`
							: needsKey
								? "sk-…"
								: ""
					}
					value={form.apiKey}
					onChange={(e) => set("apiKey", e.target.value)}
				/>
				{profile?.hasApiKey && (
					<label className="flex items-center gap-2 text-xs">
						<input
							type="checkbox"
							checked={form.removeKey}
							onChange={(e) => set("removeKey", e.target.checked)}
						/>
						{t("admin.field.removeKey")}
					</label>
				)}
			</Field>
			<div className="grid grid-cols-2 gap-2">
				<Field label={t("admin.field.temperature")} id="pf-temp">
					<Input
						id="pf-temp"
						type="number"
						min={0}
						max={2}
						step={0.1}
						value={form.temperature}
						onChange={(e) => set("temperature", Number(e.target.value))}
					/>
				</Field>
				<Field label={t("admin.field.timeout")} id="pf-timeout">
					<Input
						id="pf-timeout"
						type="number"
						min={2}
						max={600}
						value={form.timeoutSec}
						onChange={(e) => set("timeoutSec", Number(e.target.value))}
					/>
				</Field>
			</div>
			<div className="space-y-1 text-sm sm:col-span-2">
				<label className="flex items-center gap-2">
					<input
						type="checkbox"
						checked={form.verifyClaims}
						onChange={(e) => set("verifyClaims", e.target.checked)}
					/>
					{t("admin.field.verifyClaims")}
				</label>
				<label className="flex items-center gap-2">
					<input
						type="checkbox"
						checked={form.enabled}
						onChange={(e) => set("enabled", e.target.checked)}
					/>
					{t("admin.field.enabled")}
				</label>
			</div>
			<div className="flex gap-2 sm:col-span-2">
				<Button
					type="submit"
					disabled={create.isPending || update.isPending}
					data-testid="save-profile"
				>
					{t("admin.save")}
				</Button>
				<Button type="button" variant="ghost" onClick={onDone}>
					{t("admin.cancel")}
				</Button>
			</div>
		</form>
	);
}

function Field({
	label,
	id,
	hint,
	children,
}: {
	label: string;
	id: string;
	hint?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="space-y-1">
			<Label htmlFor={id}>{label}</Label>
			{children}
			{hint && <p className="text-muted-foreground text-xs">{hint}</p>}
		</div>
	);
}

function Calls() {
	const { t, i18n } = useTranslation();
	const calls = useQuery({
		...orpc.admin.calls.queryOptions(),
		refetchInterval: 10_000,
	});
	const time = new Intl.DateTimeFormat(i18n.language, {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
	const num = new Intl.NumberFormat(i18n.language);
	return (
		<section className="space-y-2">
			<h2 className="font-semibold text-lg">{t("admin.calls")}</h2>
			{calls.data?.length === 0 && (
				<p className="text-muted-foreground text-sm">{t("admin.callsEmpty")}</p>
			)}
			{calls.data && calls.data.length > 0 && (
				<div className="overflow-x-auto">
					<table className="w-full text-sm" data-testid="calls">
						<thead className="text-muted-foreground text-xs">
							<tr>
								{(
									[
										"when",
										"purpose",
										"source",
										"latency",
										"attempts",
										"fallbacks",
									] as const
								).map((c) => (
									<th key={c} className="px-2 py-1 text-start font-normal">
										{t(`admin.col.${c}`)}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{calls.data.map((c) => (
								<tr key={c.id} className="border-t align-top">
									<td className="px-2 py-1">
										{time.format(new Date(c.createdAt))}
									</td>
									<td className="px-2 py-1">{c.purpose}</td>
									<td
										className={cn(
											"px-2 py-1",
											c.source === "llm"
												? "text-green-600 dark:text-green-400"
												: c.source === "scripted"
													? "text-destructive"
													: "text-amber-600",
										)}
									>
										{c.source}
									</td>
									<td className="px-2 py-1">{num.format(c.latencyMs)} ms</td>
									<td className="px-2 py-1">{num.format(c.attempts)}</td>
									<td className="px-2 py-1">
										{num.format(c.fallbacks)}
										{c.errors.length > 0 && (
											<details>
												<summary className="cursor-pointer text-muted-foreground text-xs">
													{t("admin.errors")}
												</summary>
												<ul className="text-xs" dir="ltr">
													{c.errors.map((e, i) => (
														<li key={i}>{e}</li>
													))}
												</ul>
											</details>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</section>
	);
}
