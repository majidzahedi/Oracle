import { Button } from "@oracle/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@oracle/ui/components/dropdown-menu";
import { Skeleton } from "@oracle/ui/components/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { authClient } from "@/lib/auth-client";
import { clearToken, detachTab } from "@/lib/auth-token";

export default function UserMenu() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: session, isPending, refetch } = authClient.useSession();

	if (isPending) return <Skeleton className="h-8 w-20" />;

	if (!session) {
		return (
			<Link to="/login">
				<Button variant="outline">{t("auth.signIn")}</Button>
			</Link>
		);
	}

	const resetTab = async () => {
		queryClient.clear();
		await refetch();
		navigate({ to: "/" });
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button variant="outline" />}>
				{session.user.name}
			</DropdownMenuTrigger>
			<DropdownMenuContent className="bg-card">
				<DropdownMenuGroup>
					<DropdownMenuLabel>
						{session.user.isAnonymous
							? t("auth.guestBadge")
							: session.user.email}
					</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						onClick={() => {
							detachTab();
							void resetTab();
						}}
					>
						{t("guest.newGuestThisTab")}
					</DropdownMenuItem>
					<DropdownMenuItem
						variant="destructive"
						onClick={async () => {
							await authClient.signOut();
							clearToken();
							await resetTab();
						}}
					>
						{t("auth.signOut")}
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
