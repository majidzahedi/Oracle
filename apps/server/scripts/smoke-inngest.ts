// End-to-end check of the Inngest wiring: needs `bun run dev:server` and `bun run dev:inngest`.
// Sends `oracle/ping`, waits for the realtime `pong`, then checks the run finished.
import { systemChannel } from "../src/inngest/channels";
import { inngest } from "../src/inngest/client";
import { ping } from "../src/inngest/events";

const message = `hello ${Date.now()}`;

const stream = await inngest.realtime.subscribe({
	channel: systemChannel,
	topics: ["pong"],
});
const reader = stream.getReader();

const { ids } = await inngest.send(ping.create({ message }));
console.log("sent event", ids[0]);

const timeout = setTimeout(() => {
	console.error("FAIL: no realtime message within 20s");
	process.exit(1);
}, 20_000);

while (true) {
	const { value, done } = await reader.read();
	if (done) break;
	const data = value.data as typeof systemChannel.$infer.pong;
	if (value.topic === "pong" && data.message === `pong: ${message}`) {
		console.log("realtime received:", data);
		break;
	}
}
clearTimeout(timeout);
stream.close();

const base = process.env.INNGEST_BASE_URL ?? "http://localhost:8288";
for (let i = 0; i < 20; i++) {
	const res = await fetch(`${base}/v1/events/${ids[0]}/runs`);
	const { data } = (await res.json()) as {
		data: { status: string; output: unknown }[];
	};
	if (data[0]?.status === "Completed") {
		console.log("run completed");
		process.exit(0);
	}
	await Bun.sleep(500);
}
console.error("FAIL: run did not complete");
process.exit(1);
