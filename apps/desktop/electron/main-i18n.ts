import type { LanguageMode } from "../src/desktop-state";

type StringTable = Record<string, string>;

const en: StringTable = {
  "main.notification.runCompleted": "Agent finished responding",
  "main.notification.needsInput": "Needs your input",
  "main.notification.sessionFallback": "pi session",
  "main.menu.openWorkspaceFolder": "Open workspace folder",
  "main.update.upToDateTitle": "pi-gui",
  "main.update.upToDateMessage": "You're up to date on version {version}.",
  "main.update.checkFailedTitle": "pi-gui",
  "main.update.checkFailedMessage": "Could not check for updates right now.",
  "main.dialog.ok": "OK",
};

const zhCN: StringTable = {
  "main.notification.runCompleted": "Agent 已完成回复",
  "main.notification.needsInput": "需要你的输入",
  "main.notification.sessionFallback": "pi 会话",
  "main.menu.openWorkspaceFolder": "打开工作区文件夹",
  "main.update.upToDateTitle": "pi-gui",
  "main.update.upToDateMessage": "已是最新版本 {version}。",
  "main.update.checkFailedTitle": "pi-gui",
  "main.update.checkFailedMessage": "暂时无法检查更新。",
  "main.dialog.ok": "好",
};

const tables: Record<LanguageMode, StringTable> = { en, "zh-CN": zhCN };

let currentLanguage: LanguageMode = "en";

export function setMainLanguage(language: LanguageMode): void {
  currentLanguage = language === "zh-CN" ? "zh-CN" : "en";
}

export function getMainLanguage(): LanguageMode {
  return currentLanguage;
}

export function tMain(key: keyof typeof en, params?: Readonly<Record<string, string | number>>): string {
  const template = tables[currentLanguage]?.[key] ?? en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, paramKey: string) => {
    const value = params[paramKey];
    return value === undefined ? match : String(value);
  });
}
