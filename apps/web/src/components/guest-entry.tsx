import { Button } from "@oracle/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@oracle/ui/components/card";
import { Input } from "@oracle/ui/components/input";
import { Label } from "@oracle/ui/components/label";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

/** One-step guest sign-in: anonymous session + display name. */
export default function GuestEntry() {
	const { t } = useTranslation();
	const { refetch } = authClient.useSession();
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const trimmed = name.trim();

	const enter = async () => {
		if (trimmed.length < 2) {
			toast.error(t("auth.nameMin"));
			return;
		}
		setBusy(true);
		try {
			const res = await authClient.signIn.anonymous();
			if (res.error) throw res.error;
			const upd = await authClient.updateUser({ name: trimmed });
			if (upd.error) throw upd.error;
			await refetch();
		} catch (e) {
			toast.error((e as Error).message || t("errors.generic"));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Card className="panel mx-auto w-full max-w-md overflow-visible ring-0">
			<CardHeader>
				<CardTitle className="display text-xl">{t("guest.title")}</CardTitle>
				<CardDescription>{t("guest.subtitle")}</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					className="space-y-3"
					onSubmit={(e) => {
						e.preventDefault();
						void enter();
					}}
				>
					<Label htmlFor="guest-name" className="sr-only">
						{t("auth.name")}
					</Label>
					<Input
						id="guest-name"
						autoFocus
						maxLength={24}
						placeholder={t("guest.namePlaceholder")}
						value={name}
						onChange={(e) => setName(e.target.value)}
					/>
					<Button
						type="submit"
						size="lg"
						className="w-full"
						disabled={busy || trimmed.length < 2}
					>
						{t("guest.enter")}
					</Button>
					<div className="text-center">
						<Link
							to="/login"
							className="text-muted-foreground text-xs underline-offset-4 hover:underline"
						>
							{t("guest.orEmail")}
						</Link>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}
