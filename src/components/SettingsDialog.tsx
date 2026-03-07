import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveSystemLanguage } from "@/i18n";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Sun, Moon, Monitor } from "lucide-react";

type Theme = "light" | "dark" | "system";

const LANGUAGES = [
  { code: "zh-TW", label: "繁體中文" },
  { code: "en", label: "English" },
];

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") {
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    root.classList.toggle("dark", prefersDark);
  } else {
    root.classList.toggle("dark", theme === "dark");
  }
}

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem("theme") as Theme) || "system";
  });
  const [langPref, setLangPref] = useState(() => {
    return localStorage.getItem("language") || "system";
  });

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  // Listen for system theme changes when in "system" mode
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const handleLanguageChange = (value: string | null) => {
    if (!value) return;
    setLangPref(value);
    localStorage.setItem("language", value);
    const lang = value === "system" ? resolveSystemLanguage() : value;
    i18n.changeLanguage(lang);
  };

  const themeOptions = [
    { value: "system" as Theme, label: t("themeSystem"), icon: Monitor },
    { value: "light" as Theme, label: t("themeLight"), icon: Sun },
    { value: "dark" as Theme, label: t("themeDark"), icon: Moon },
  ];

  const langDisplayLabel =
    langPref === "system"
      ? t("languageSystem")
      : LANGUAGES.find((l) => l.code === langPref)?.label || langPref;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("settings")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <Label className="text-xs">{t("theme")}</Label>
            <div className="flex gap-1.5">
              {themeOptions.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setTheme(value)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors ${
                    theme === value
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">{t("language")}</Label>
            <Select value={langPref} onValueChange={handleLanguageChange}>
              <SelectTrigger>
                <SelectValue>{langDisplayLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">{t("languageSystem")}</SelectItem>
                {LANGUAGES.map(({ code, label }) => (
                  <SelectItem key={code} value={code}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Apply saved theme on app load
export function initTheme() {
  const theme = (localStorage.getItem("theme") as Theme) || "system";
  applyTheme(theme);
}
