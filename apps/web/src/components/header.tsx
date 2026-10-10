import { Button } from "@oracle/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { OracleEye } from "@/components/oracle-eye";
import { setLanguage } from "@/i18n";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

export default function Header() {
	const { t, i18n } = useTranslation();
	const { data: session } = authClient.useSession();
	const admin = useQuery({
		...orpc.admin.me.queryOptions(),
		enabled: Boolean(session && !session.user.isAnonymous),
	});
	return (
		<header className="sticky top-0 z-20 border-b bg-background/75 backdrop-blur-md">
			<div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-2">
				<Link to="/" className="group flex items-center gap-2">
					<OracleEye className="h-6 w-9 transition group-hover:scale-110" />
					<span className="display font-bold text-lg">{t("app.title")}</span>
				</Link>
				<div className="flex items-center gap-2">
					{admin.data?.isAdmin && (
						<Link
							to="/admin"
							className="hidden text-muted-foreground text-sm hover:text-foreground sm:inline"
							data-testid="admin-link"
						>
							{t("admin.title")}
						</Link>
					)}
					<Link
						to="/how-to-play"
						className="hidden text-muted-foreground text-sm hover:text-foreground sm:inline"
					>
						{t("game.howToPlay")}
					</Link>
					<Button
						variant="ghost"
						size="sm"
						lang={i18n.language === "fa" ? "en" : "fa"}
						title={t("lang.label")}
						onClick={() => setLanguage(i18n.language === "fa" ? "en" : "fa")}
					>
						{t("lang.switchTo")}
					</Button>
					<ModeToggle />
					<UserMenu />
				</div>
			</div>
		</header>
	);
}
