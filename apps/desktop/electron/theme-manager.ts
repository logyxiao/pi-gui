import { nativeTheme, type BrowserWindow } from "electron";
import { desktopIpc } from "../src/ipc";
import type { ThemeMode } from "../src/desktop-state";

const THEME_BACKGROUND_COLORS = {
  dark: "#1e1f22",
  light: "#fbfbfd",
} as const;

export function getThemeBackgroundColor(theme: "light" | "dark"): string {
  return THEME_BACKGROUND_COLORS[theme];
}

export class ThemeManager {
  private mode: ThemeMode = "system";
  private window: BrowserWindow | null = null;

  constructor() {
    nativeTheme.on("updated", () => {
      this.broadcast();
    });
  }

  setWindow(win: BrowserWindow) {
    this.window = win;
    this.applyWindowTheme();
  }

  getMode(): ThemeMode {
    return this.mode;
  }

  getResolvedTheme(): "light" | "dark" {
    if (this.mode === "system") {
      return nativeTheme.shouldUseDarkColors ? "dark" : "light";
    }
    return this.mode;
  }

  setMode(mode: ThemeMode) {
    this.mode = mode;
    if (mode === "system") {
      nativeTheme.themeSource = "system";
    } else {
      nativeTheme.themeSource = mode;
    }
    this.broadcast();
  }

  private broadcast() {
    const resolvedTheme = this.getResolvedTheme();
    this.applyWindowTheme(resolvedTheme);
    this.window?.webContents.send(desktopIpc.themeChanged, resolvedTheme);
  }

  private applyWindowTheme(theme = this.getResolvedTheme()) {
    this.window?.setBackgroundColor(getThemeBackgroundColor(theme));
  }
}
