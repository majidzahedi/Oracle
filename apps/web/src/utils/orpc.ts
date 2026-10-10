import type { AppRouterClient } from "@oracle/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ENV } from "../env";
import i18n, { errorText } from "../i18n";
import { getToken } from "../lib/auth-token";

export function createQueryClient() {
	return new QueryClient({
		queryCache: new QueryCache({
			onError: (error, query) => {
				toast.error(errorText(error), {
					action: {
						label: i18n.t("errors.retry"),
						onClick: () => {
							query.invalidate();
						},
					},
				});
			},
		}),
	});
}

export const queryClient = createQueryClient();

export const link = new RPCLink({
	url: `${ENV.VITE_SERVER_URL.replace(/\/$/, "")}/rpc`,
	headers: () => {
		const token = getToken();
		return token ? { Authorization: `Bearer ${token}` } : {};
	},
	fetch(request, init) {
		// Bearer auth only: each tab carries its own session token.
		return fetch(request, { ...init, credentials: "omit" });
	},
});

export const client: AppRouterClient = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
