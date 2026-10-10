import type { Claim } from "@oracle/engine";

export type Lang = "fa" | "en";
/** Engine player id -> display name. */
export type Names = Record<string, string>;

type Ctx = { p: string; r: string };
type Variants = Record<Lang, Array<(c: Ctx) => string>>;

const num = (n: number, lang: Lang) => new Intl.NumberFormat(lang).format(n);

/** Statement templates. `pos` asserts the claim, `neg` asserts its negation. */
const TEMPLATES: Record<
	"isTraitor" | "receivedPact" | "playedOffType" | "traitorExists",
	{ pos: Variants; neg: Variants }
> = {
	isTraitor: {
		pos: {
			en: [
				(c) => `${c.p} has accepted my offer. They work for me now.`,
				(c) => `Watch ${c.p}. ${c.p} serves me.`,
			],
			fa: [
				(c) => `${c.p} پیشنهاد مرا پذیرفته است. اکنون برای من کار می‌کند.`,
				(c) => `مراقب ${c.p} باش. او خدمتگزار من است.`,
			],
		},
		neg: {
			en: [
				(c) => `${c.p} has never served me. Not yet.`,
				(c) => `${c.p} is clean, as far as I am concerned.`,
			],
			fa: [
				(c) => `${c.p} هرگز به من خدمت نکرده است. هنوز نه.`,
				(c) => `تا آنجا که به من مربوط است، ${c.p} پاک است.`,
			],
		},
	},
	receivedPact: {
		pos: {
			en: [
				(c) => `I made ${c.p} an offer in the dark.`,
				(c) => `${c.p} has heard my proposal.`,
			],
			fa: [
				(c) => `در تاریکی به ${c.p} پیشنهادی دادم.`,
				(c) => `${c.p} پیشنهاد مرا شنیده است.`,
			],
		},
		neg: {
			en: [
				(c) => `I have never spoken privately to ${c.p}.`,
				(c) => `${c.p} has never heard my offer.`,
			],
			fa: [
				(c) => `هرگز در خلوت با ${c.p} سخن نگفته‌ام.`,
				(c) => `${c.p} هرگز پیشنهاد مرا نشنیده است.`,
			],
		},
	},
	playedOffType: {
		pos: {
			en: [
				(c) => `In round ${c.r}, ${c.p} slipped a wrong card into the pile.`,
				(c) => `${c.p} sabotaged the lock in round ${c.r}.`,
			],
			fa: [
				(c) => `در دور ${c.r}، ${c.p} کارتی نادرست در توده گذاشت.`,
				(c) => `${c.p} در دور ${c.r} قفل را خراب کرد.`,
			],
		},
		neg: {
			en: [
				(c) => `Every card ${c.p} played in round ${c.r} was honest.`,
				(c) => `${c.p} did nothing wrong in round ${c.r}.`,
			],
			fa: [
				(c) => `همهٔ کارت‌هایی که ${c.p} در دور ${c.r} بازی کرد درست بود.`,
				(c) => `${c.p} در دور ${c.r} خطایی نکرد.`,
			],
		},
	},
	traitorExists: {
		pos: {
			en: [
				() => "One of you already belongs to me.",
				() => "Someone among you has made a deal with me.",
			],
			fa: [
				() => "یکی از شما پیش‌تر از آنِ من شده است.",
				() => "کسی در میان شما با من معامله کرده است.",
			],
		},
		neg: {
			en: [
				() => "None of you has accepted my offer. Yet.",
				() => "You are all still loyal to each other. How quaint.",
			],
			fa: [
				() => "هیچ‌کدام از شما پیشنهاد مرا نپذیرفته‌اید. هنوز.",
				() => "همهٔ شما هنوز به هم وفادارید. چه دلنشین.",
			],
		},
	},
};

/** Renders the exact statement a claim makes. `variant` picks among phrasings. */
export function renderClaim(
	claim: Claim,
	names: Names,
	lang: Lang,
	variant = 0,
): string {
	let positive = true;
	let c = claim;
	while (c.type === "not") {
		positive = !positive;
		c = c.claim;
	}
	if (c.type === "noTraitorYet") {
		positive = !positive;
		c = { type: "traitorExists" };
	}
	const ctx: Ctx = {
		p: "player" in c ? (names[c.player] ?? c.player) : "",
		r: c.type === "playedOffType" ? num(c.round, lang) : "",
	};
	const list = TEMPLATES[c.type][positive ? "pos" : "neg"][lang];
	const fn = list[Math.abs(variant) % list.length] as (c: Ctx) => string;
	return fn(ctx);
}

export const OPENERS: Record<
	"night" | "whisper" | "lieDetector",
	Record<Lang, string[]>
> = {
	night: {
		en: [
			"Listen closely.",
			"A gift, for you alone.",
			"How delightful. A secret.",
			"Between us, little one:",
		],
		fa: [
			"خوب گوش کن.",
			"هدیه‌ای، فقط برای تو.",
			"چه دلپذیر. یک راز.",
			"میان خودمان بماند، کوچولو:",
		],
	},
	whisper: {
		en: [
			"Let me share something with all of you.",
			"I could not keep this to myself.",
		],
		fa: [
			"بگذارید چیزی را با همهٔ شما در میان بگذارم.",
			"نتوانستم این را پیش خودم نگه دارم.",
		],
	},
	lieDetector: {
		en: ["The truth, since you insist:", "I cannot lie to this machine. So:"],
		fa: ["حقیقت، چون اصرار داری:", "به این دستگاه نمی‌توانم دروغ بگویم. پس:"],
	},
};

export function renderMercy(player: string, names: Names, lang: Lang): string {
	const p = names[player] ?? player;
	return lang === "fa"
		? `${p} لطف مرا به دست آورده است.`
		: `${p} has earned my favor.`;
}
