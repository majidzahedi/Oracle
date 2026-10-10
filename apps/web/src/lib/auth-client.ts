import { anonymousClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { ENV } from "../env";
import { getToken, isRememberedToken, saveToken } from "./auth-token";

export const authClient = createAuthClient({
	baseURL: ENV.VITE_SERVER_URL,
	plugins: [anonymousClient()],
	fetchOptions: {
		// Bearer tokens only (no cookies), so each tab can hold its own session.
		credentials: "omit",
		auth: { type: "Bearer", token: () => getToken() ?? undefined },
		onSuccess: (ctx) => {
			const token = ctx.response.headers.get("set-auth-token");
			if (!token) return;
			const url = ctx.request.url.toString();
			const emailAuth =
				url.includes("/sign-in/email") || url.includes("/sign-up/email");
			saveToken(token, { remember: emailAuth || isRememberedToken() });
		},
	},
});
