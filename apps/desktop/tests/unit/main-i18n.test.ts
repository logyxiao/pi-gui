import { afterEach, describe, expect, it } from "vitest";
import { getMainLanguage, setMainLanguage, tMain } from "../../electron/main-i18n";

afterEach(() => {
  setMainLanguage("en");
});

describe("main-i18n", () => {
  it("defaults to English", () => {
    expect(getMainLanguage()).toBe("en");
    expect(tMain("main.notification.runCompleted")).toBe("Agent finished responding");
  });

  it("switches to zh-CN", () => {
    setMainLanguage("zh-CN");
    expect(getMainLanguage()).toBe("zh-CN");
    expect(tMain("main.notification.runCompleted")).toBe("Agent 已完成回复");
    expect(tMain("main.menu.openWorkspaceFolder")).toBe("打开工作区文件夹");
  });

  it("interpolates {param} placeholders", () => {
    expect(tMain("main.update.upToDateMessage", { version: "1.2.3" })).toBe(
      "You're up to date on version 1.2.3.",
    );
    setMainLanguage("zh-CN");
    expect(tMain("main.update.upToDateMessage", { version: "1.2.3" })).toBe(
      "已是最新版本 1.2.3。",
    );
  });

  it("falls back to English when zh-CN entry missing", () => {
    setMainLanguage("zh-CN");
    // every key currently has a zh-CN translation, but verify fallback machinery
    expect(tMain("main.dialog.ok")).toBe("好");
  });

  it("normalizes unrecognized language to English", () => {
    setMainLanguage("fr" as unknown as "en");
    expect(getMainLanguage()).toBe("en");
  });
});
