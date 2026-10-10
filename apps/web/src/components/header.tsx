import { Button } from "@oracle/ui/components/button";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { setLanguage } from "@/i18n";

import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

export default function Header() {
	const { t, i18n } = useTranslation();
	return (
		<header className="border-b">
			<div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-2">
				<Link to="/" className="font-bold text-lg tracking-wide">
					{t("app.title")}
				</Link>
				<div className="flex items-center gap-2">
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
