import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { isolateWords } from "@/lib/bidi";

import { en } from "./en";
import { fa } from "./fa";

export const LANGUAGES = ["fa", "en"] as const;
export type Language = (typeof LANGUAGES)[number];
const STORAGE_KEY = "oracle.lang";

function savedLanguage(): Language {
	try {
		return localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "fa";
	} catch {
		return "fa";
	}
}

function applyDocumentLanguage(lng: string) {
	document.documentElement.lang = lng;
	document.documentElement.dir = i18n.dir(lng);
}

i18n.use(initReactI18next).init({
	resources: { en: { translation: en }, fa: { translation: fa } },
	lng: savedLanguage(),
	fallbackLng: "en",
	// React escapes; the "escape" here isolates each inserted value (names in
	// another script) so it can't reorder the sentence around it.
	interpolation: { escapeValue: true, escape: isolateWords },
});
applyDocumentLanguage(i18n.language);
i18n.on("languageChanged", applyDocumentLanguage);

export function setLanguage(lng: Language) {
	try {
		localStorage.setItem(STORAGE_KEY, lng);
	} catch {
		// private mode: language just won't persist
	}
	void i18n.changeLanguage(lng);
}

/** Maps an API error (oRPC message key) to translated text. */
export function errorText(error: unknown): string {
	const e = error as { message?: string; code?: string };
	for (const key of [e?.message, e?.code]) {
		if (key && i18n.exists(`errors.${key}`))
			return i18n.t(`errors.${key}` as "errors.generic");
	}
	return i18n.t("errors.generic");
}

declare module "i18next" {
	interface CustomTypeOptions {
		resources: { translation: typeof en };
	}
}

export default i18n;
