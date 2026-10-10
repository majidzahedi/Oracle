import { Inngest } from "inngest";

import { ENV } from "../env.server";

// v4 defaults to cloud mode; INNGEST_DEV=true points the client at the local Dev Server.
export const inngest = new Inngest({
	id: "oracle",
	isDev: ENV.INNGEST_DEV ?? false,
	baseUrl: ENV.INNGEST_BASE_URL,
	signingKey: ENV.INNGEST_SIGNING_KEY,
	eventKey: ENV.INNGEST_EVENT_KEY,
});
