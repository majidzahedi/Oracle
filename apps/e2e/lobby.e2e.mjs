import { chromium } from "playwright";

// Browser test of the lobby. Needs web, server, Inngest Dev Server and Postgres running.
// Usage: bun run e2e [screenshot-dir]  (WEB_URL defaults to http://localhost:3001)
const out = process.argv[2] ?? "/tmp";
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
const errors = [];

async function guest(page, name) {
	await page.getByPlaceholder("نام شما").fill(name);
	await page.getByRole("button", { name: "ورود به عنوان مهمان" }).click();
}

// --- 4 tabs in ONE browser context (shared localStorage/cookies)
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const pages = await Promise.all([1, 2, 3, 4].map(() => ctx.newPage()));
for (const p of pages)
	p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const [p1, p2, p3, p4] = pages;
await p1.goto(`${WEB}/`);
if ((await p1.getAttribute("html", "dir")) !== "rtl")
	fail("default dir not rtl");
await guest(p1, "Ana");
await p1.getByRole("button", { name: "ساخت بازی" }).last().click();
await p1.waitForURL(/\/g\/[A-Z0-9]{5}$/);
const code = p1.url().split("/").pop();
console.log("code", code);
await p1
	.getByTestId("live-status")
	.and(p1.locator('[data-status="open"]'))
	.waitFor({ timeout: 15000 });

const names = ["Bita", "Cyrus", "Dara"];
for (const [i, p] of [p2, p3, p4].entries()) {
	await p.goto(`${WEB}/g/${code}`);
	await guest(p, names[i]);
	await p
		.getByTestId(`seat-${i + 1}`)
		.getByRole("button", { name: "اینجا بنشین" })
		.click();
	await p
		.getByTestId(`seat-${i + 1}-name`)
		.filter({ hasText: names[i] })
		.waitFor({ timeout: 5000 });
}
// Host tab sees all seats without reloading (realtime push; polling is 15s).
const t0 = Date.now();
await p1
	.getByTestId("seat-3-name")
	.filter({ hasText: "Dara" })
	.waitFor({ timeout: 5000 });
console.log("host saw last seat after", Date.now() - t0, "ms");
// Each tab is a different user.
for (const [i, p] of pages.entries()) {
	const mine = await p
		.locator('[data-testid^="seat-"].ring-2')
		.getAttribute("data-testid");
	if (mine !== `seat-${i}`) fail(`tab ${i} thinks its seat is ${mine}`);
}
await p1.screenshot({ path: `${out}/lobby-full.png`, fullPage: true });
// Non-host cannot start
if (await p2.getByRole("button", { name: "شروع بازی" }).count())
	fail("non-host sees start");
await p1.getByRole("button", { name: "شروع بازی" }).click();
for (const p of pages)
	await p.getByTestId("game-started").waitFor({ timeout: 5000 });
console.log("4 tabs: game started for all");
// Reload keeps the per-tab identity
await p3.reload();
await p3.getByTestId("game-started").waitFor();
const ringed = await p3
	.locator('[data-testid^="seat-"].ring-2')
	.getAttribute("data-testid");
if (ringed !== "seat-2") fail("reload lost identity: " + ringed);
console.log("reload keeps tab identity");

// --- 1 human + 3 bots, English
const c2 = await b.newContext({ viewport: { width: 1280, height: 800 } });
const h = await c2.newPage();
await h.goto(`${WEB}/`);
await h.getByRole("button", { name: "English" }).click();
if ((await h.getAttribute("html", "dir")) !== "ltr") fail("english not ltr");
await h.getByPlaceholder("Your name").fill("Solo");
await h.getByRole("button", { name: "Enter as guest" }).click();
await h.getByRole("button", { name: "Create a game" }).last().click();
await h.waitForURL(/\/g\//);
await h.getByRole("button", { name: "Fill empty seats with bots" }).click();
await h.getByTestId("seat-3-name").filter({ hasText: "Bot 4" }).waitFor();
await h.screenshot({ path: `${out}/lobby-bots-en.png`, fullPage: true });
await h.getByRole("button", { name: "Start game" }).click();
await h.getByTestId("game-started").waitFor();
console.log("1 human + 3 bots: started");
await h.goto(`${WEB}/`);
await h.getByText("In progress").first().waitFor();
await h.screenshot({ path: `${out}/home-en.png`, fullPage: true });

console.log(
	"console errors:",
	errors.filter((e) => !e.includes("favicon")),
);
await b.close();
