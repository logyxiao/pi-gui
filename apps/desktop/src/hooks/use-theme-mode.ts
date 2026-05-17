import { useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";

export interface ThemeModeController {
  readonly mode: ThemeMode;
  readonly setMode: (mode: ThemeMode) => void;
}

export function useThemeMode(): ThemeModeController {
  const [mode, setMode] = useState<ThemeMode>("system");

  useEffect(() => {
    const piApi = window.piApp;
    if (!piApi) return;

    void piApi.getResolvedTheme().then((theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
    });

    void piApi.getThemeMode().then((next) => {
      setMode(next);
    });

    return piApi.onThemeChanged((theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
    });
  }, []);

  return { mode, setMode };
}
