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
	await p.getByTestId("game-screen").waitFor({ timeout: 5000 });
console.log("4 tabs: game screen shown in all tabs");
// Reload keeps the per-tab identity
await p3.reload();
await p3.getByTestId("game-screen").waitFor();
// After reload, tab 3 is still Cyrus (seat 3 = engine id p3).
const me3 = await p3.getByTestId("player-p3").textContent();
if (!me3.includes("Cyrus") || !me3.includes("(شما)"))
	fail(`reload lost identity: ${me3}`);
console.log("reload keeps tab identity");

// Chat replies: tab 2 answers tab 1's line; everyone sees the quote.
await p1.getByTestId("tab-chat").click();
await p1.getByTestId("chat-input").fill("کی ژنراتور رو باز کرد؟");
await p1.getByRole("button", { name: "ارسال" }).click();
await p2.getByTestId("tab-chat").click();
const asked = p2.locator('[data-testid^="chat-"]', {
	hasText: "کی ژنراتور رو باز کرد؟",
});
await asked.waitFor();
await asked.locator('[data-testid^="reply-"]').click();
await p2.getByTestId("replying-to").waitFor();
await p2.getByTestId("chat-input").fill("Ana نبود، من بودم!");
await p2.getByTestId("chat-input").press("Enter");
await p2.getByTestId("replying-to").waitFor({ state: "detached" });
const quoted = p1.getByTestId("chat-quote").filter({
	hasText: "کی ژنراتور رو باز کرد؟",
});
await quoted.waitFor({ timeout: 15000 });
await quoted.click();
await p1.getByTestId("chat").screenshot({ path: `${out}/chat-reply.png` });
console.log("chat reply shown with its quote");

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
await h.getByTestId("game-screen").waitFor();
const lang = await h
	.getByTestId("night-message")
	.first()
	.textContent({ timeout: 15000 });
if (/[\u0600-\u06FF]/.test(lang))
	fail(`Oracle spoke Persian in an English game: ${lang}`);
console.log("Oracle speaks English in an English game:", lang);
console.log("1 human + 3 bots: started");
await h.goto(`${WEB}/`);
await h.getByText("In progress").first().waitFor();
await h.screenshot({ path: `${out}/home-en.png`, fullPage: true });

console.log(
	"console errors:",
	errors.filter((e) => !e.includes("favicon")),
);
await b.close();
