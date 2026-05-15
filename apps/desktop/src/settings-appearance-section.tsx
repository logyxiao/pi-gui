import type { LanguageMode, ThemeMode } from "./desktop-state";
import { LANGUAGE_OPTIONS, useI18n } from "./i18n";
import { SettingsGroup, SettingsRow } from "./settings-utils";

interface SettingsAppearanceSectionProps {
  readonly themeMode: ThemeMode;
  readonly language: LanguageMode;
  readonly onSetThemeMode: (mode: ThemeMode) => void;
  readonly onSetLanguage: (language: LanguageMode) => void;
}

const THEME_OPTIONS: { mode: ThemeMode; labelKey: "settings.appearance.system" | "settings.appearance.light" | "settings.appearance.dark"; descriptionKey: "settings.appearance.systemDescription" | "settings.appearance.lightDescription" | "settings.appearance.darkDescription" }[] = [
  { mode: "system", labelKey: "settings.appearance.system", descriptionKey: "settings.appearance.systemDescription" },
  { mode: "light", labelKey: "settings.appearance.light", descriptionKey: "settings.appearance.lightDescription" },
  { mode: "dark", labelKey: "settings.appearance.dark", descriptionKey: "settings.appearance.darkDescription" },
];

export function SettingsAppearanceSection({ themeMode, language, onSetThemeMode, onSetLanguage }: SettingsAppearanceSectionProps) {
  const { t } = useI18n();

  return (
    <>
      <SettingsGroup title={t("settings.appearance.theme")}>
        {THEME_OPTIONS.map((option) => (
          <SettingsRow key={option.mode} title={t(option.labelKey)} description={t(option.descriptionKey)}>
            <input
              checked={themeMode === option.mode}
              name="theme"
              type="radio"
              onChange={() => onSetThemeMode(option.mode)}
            />
          </SettingsRow>
        ))}
      </SettingsGroup>
      <SettingsGroup title={t("settings.appearance.language")} description={t("settings.appearance.languageDescription")}>
        {LANGUAGE_OPTIONS.map((option) => (
          <SettingsRow key={option.code} title={option.nativeLabel} description={option.label}>
            <input
              aria-label={option.nativeLabel}
              checked={language === option.code}
              name="language"
              type="radio"
              onChange={() => onSetLanguage(option.code)}
            />
          </SettingsRow>
        ))}
      </SettingsGroup>
    </>
  );
}
