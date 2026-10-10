import { chromium } from "playwright";

// Full game in the browser: 4 tabs of one browser play from the lobby to the end
// screen, each tab acting through the UI only. Run the server with short phase
// timers (see README). Usage: bun run e2e:game [screenshot-dir] [--bots]
const out = process.argv[2] ?? "/tmp";
const withBots = process.argv.includes("--bots");
const WEB = process.env.WEB_URL ?? "http://localhost:3001";
const b = await chromium.launch(
	process.env.CHROMIUM_PATH
		? { executablePath: process.env.CHROMIUM_PATH }
		: {},
);
const fail = (m) => {
	console.error("FAIL:", m);
	process.exit(1);
};

const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const humans = withBots ? 1 : 4;
const pages = await Promise.all(
	Array.from({ length: humans }, () => ctx.newPage()),
);
const errors = [];
for (const p of pages) p.on("pageerror", (e) => errors.push(String(e)));

async function guest(page, name) {
	await page.getByPlaceholder("Your name").fill(name);
	await page.getByRole("button", { name: "Enter as guest" }).click();
}

// English UI for readable selectors.
const p1 = pages[0];
await p1.goto(`${WEB}/`);
await p1.getByRole("button", { name: "English" }).click();
await guest(p1, "Ana");
await p1.getByRole("button", { name: "Create a game" }).last().click();
await p1.waitForURL(/\/g\/[A-Z0-9]{5}$/);
const code = p1.url().split("/").pop();
console.log("code", code);
const names = ["Bita", "Cyrus", "Dara"];
for (const [i, p] of pages.slice(1).entries()) {
	await p.goto(`${WEB}/g/${code}`);
	await guest(p, names[i]);
	await p
		.getByTestId(`seat-${i + 1}`)
		.getByRole("button", { name: "Sit here" })
		.click();
	await p
		.getByTestId(`seat-${i + 1}-name`)
		.filter({ hasText: names[i] })
		.waitFor();
}
if (withBots)
	await p1.getByRole("button", { name: "Fill empty seats with bots" }).click();
await p1
	.getByTestId("seat-3")
	.filter({ hasText: withBots ? "Bot 4" : "Dara" })
	.waitFor();
await p1.getByRole("button", { name: "Start game" }).click();
for (const p of pages)
	await p.getByTestId("game-screen").waitFor({ timeout: 10000 });
console.log("game screen shown in all tabs");

const seen = new Set();
const shots = new Set();
const visible = async (loc) =>
	(await loc.count()) > 0 && (await loc.first().isVisible());

/** One decision for one tab, made only from what the UI shows. */
async function step(p, i) {
	if (await visible(p.getByTestId("end-screen"))) return true;
	const bar = p.getByTestId("phase-bar");
	const phase = await bar.getAttribute("data-phase").catch(() => null);
	const round = await bar.getAttribute("data-round").catch(() => null);
	if (phase) seen.add(phase);
	if (i === 0 && phase && !shots.has(phase)) {
		shots.add(phase);
		await p.screenshot({ path: `${out}/game-${phase}.png`, fullPage: true });
	}
	if (await visible(p.getByTestId("pact-offer"))) {
		// Tab 2 accepts so that games with a traitor get exercised.
		await p
			.getByRole("button", { name: i === 1 ? "Accept the Pact" : "Refuse" })
			.click();
		console.log(`tab ${i} answered a Pact offer in round ${round}`);
		return false;
	}
	const ready = p.getByTestId("ready");
	if ((await visible(ready)) && (await ready.isEnabled())) {
		await ready.click();
		return false;
	}
	if (await visible(p.getByTestId("play"))) {
		const needed = [];
		for (const t of ["power", "code", "force"])
			if (await visible(p.getByTestId(`progress-${t}`))) needed.push(t);
		const cards = await p
			.getByTestId("play-area")
			.locator('[data-testid^="hand-"]')
			.evaluateAll((els) =>
				els.map((e) => e.getAttribute("data-testid").slice(5)),
			);
		const tools = cards
			.map((id) => ({
				id,
				type: id.split("-")[0],
				value: Number(id.split("-")[1]),
			}))
			.filter((c) => ["power", "code", "force"].includes(c.type));
		const matching = tools
			.filter((c) => needed.includes(c.type))
			.sort((a, b) => b.value - a.value);
		const pick = (matching.length ? matching : tools).slice(0, 2);
		for (const c of pick) await p.getByTestId(`hand-${c.id}`).click();
		await p.getByTestId("play").click();
		return false;
	}
	const voteNone = p.getByTestId("vote-none");
	if (
		(await visible(voteNone)) &&
		(await voteNone.getAttribute("class")).includes("outline")
	) {
		await voteNone.click();
	}
	return false;
}

const deadline = Date.now() + 8 * 60 * 1000;
const done = new Array(pages.length).fill(false);
while (!done.every(Boolean)) {
	if (Date.now() > deadline) fail(`timeout; phases seen: ${[...seen]}`);
	await Promise.all(
		pages.map(async (p, i) => {
			if (done[i]) return;
			try {
				done[i] = await step(p, i);
			} catch (e) {
				// Re-rendering under us is fine; try again next tick.
				if (!String(e).includes("detached") && !String(e).includes("Timeout"))
					console.log("step error", String(e).slice(0, 200));
			}
		}),
	);
	await new Promise((r) => setTimeout(r, 400));
}
const outcome = await p1.getByTestId("end-screen").getAttribute("data-outcome");
const msgs = await p1.getByTestId("log-messages").locator("li").count();
console.log(
	`game over: ${outcome}; phases seen: ${[...seen].join(",")}; ${msgs} logged messages`,
);
if (msgs === 0) fail("log is empty");
await p1.screenshot({ path: `${out}/game-end.png`, fullPage: true });
console.log("page errors:", errors);
await b.close();
