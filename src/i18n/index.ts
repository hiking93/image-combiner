import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zhTW from "./locales/zh-TW.json";
import en from "./locales/en.json";

const SUPPORTED_LANGS = ["zh-TW", "en"];

export function resolveSystemLanguage(): string {
  const nav = navigator.language;
  if (SUPPORTED_LANGS.includes(nav)) return nav;
  const prefix = nav.split("-")[0];
  return SUPPORTED_LANGS.find((l) => l.startsWith(prefix)) || "en";
}

function getInitialLanguage(): string {
  const saved = localStorage.getItem("language");
  if (saved && saved !== "system") return saved;
  return resolveSystemLanguage();
}

i18n.use(initReactI18next).init({
  resources: {
    "zh-TW": { translation: zhTW },
    en: { translation: en },
  },
  lng: getInitialLanguage(),
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
