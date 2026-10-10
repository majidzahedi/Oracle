import { chromium } from "playwright";

// Admin dashboard + LLM Oracle in the browser. Needs the server with
// ADMIN_EMAILS containing ADMIN_EMAIL, and an Ollama (or compatible) server at
// OLLAMA_URL serving OLLAMA_MODEL. Usage: bun run e2e:admin [screenshot-dir]
const out = process.argv[2] ?? "/tmp";
const WEB = process.env.WEB_URL ?? "http://localhost:3001";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@oracle.local";
const OLLAMA_URL = process.env.OLLAMA_URL ?? "";
const MODEL = process.env.OLLAMA_MODEL ?? "llama3.2";
const b = await chromium.launch(
	process.env.CHROMIUM_PATH
		? { executablePath: process.env.CHROMIUM_PATH }
		: {},
);
const fail = (m) => {
	console.error("FAIL:", m);
	process.exit(1);
};

// A guest is not an admin.
const g = await (await b.newContext()).newPage();
await g.goto(`${WEB}/admin`);
await g.getByRole("button", { name: "English" }).click();
await g.getByTestId("not-admin").waitFor();
console.log("guest: admin page refused");

const p = await (
	await b.newContext({ viewport: { width: 1280, height: 900 } })
).newPage();
await p.goto(`${WEB}/login`);
await p.getByRole("button", { name: "English" }).click();
await p.getByLabel("Name").fill("Admin");
await p.getByLabel("Email").fill(ADMIN_EMAIL);
await p.getByLabel("Password").fill("admin-password-123");
await p.getByRole("button", { name: "Sign up" }).click();
await p.waitForTimeout(1500);
if (p.url().includes("/login")) {
	// Already registered: sign in instead.
	await p.getByRole("button", { name: /Already have an account/ }).click();
	await p.getByLabel("Email").fill(ADMIN_EMAIL);
	await p.getByLabel("Password").fill("admin-password-123");
	await p.locator("form").getByRole("button", { name: "Sign in" }).click();
}
await p.getByTestId("admin-link").click();
await p.waitForURL(/\/admin$/);
console.log("admin: dashboard open");

const name = `Local Ollama ${Date.now().toString(36)}`;
await p.getByTestId("new-profile").click();
await p.getByLabel("Name").fill(name);
if (OLLAMA_URL) await p.getByLabel("Base URL").fill(OLLAMA_URL);
await p.getByRole("button", { name: "Find models" }).click();
await p.getByText(/models found/).waitFor();
await p.getByLabel("Model", { exact: true }).fill(MODEL);
await p.getByTestId("save-profile").click();
const card = p.getByTestId(`profile-${name}`);
await card.waitFor();
await card.getByTestId("test-profile").click();
const result = await card
	.getByTestId("test-result")
	.textContent({ timeout: 60000 });
if (!result.startsWith("Works")) fail(`profile test: ${result}`);
console.log("profile test:", result);
await card.getByTestId("make-default").click();
await card.getByText("Default", { exact: true }).waitFor();
await p.screenshot({ path: `${out}/admin.png`, fullPage: true });

// A game on the default profile: the night message comes from the model.
await p.goto(`${WEB}/`);
await p.getByRole("button", { name: "Create a game" }).last().click();
await p.waitForURL(/\/g\//);
const picked = await p
	.locator("#oracle-choice")
	.evaluate((el) => el.selectedOptions[0]?.textContent ?? "");
if (!picked.includes(name)) fail(`lobby picker shows "${picked}"`);
console.log("lobby picker:", picked);
await p.getByRole("button", { name: "Fill empty seats with bots" }).click();
await p.getByTestId("seat-3-name").waitFor();
await p.screenshot({ path: `${out}/lobby-oracle.png`, fullPage: true });
await p.getByRole("button", { name: "Start game" }).click();
const msg = await p
	.getByTestId("night-message")
	.first()
	.textContent({ timeout: 90000 });
console.log("night message:", msg);
await p.screenshot({ path: `${out}/night-llm.png`, fullPage: true });

await p.goto(`${WEB}/admin`);
await p
	.getByTestId("calls")
	.getByText("llm")
	.first()
	.waitFor({ timeout: 15000 });
console.log("admin: call log shows an llm night call");
await b.close();
