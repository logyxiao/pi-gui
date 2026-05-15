import { expect, test } from "@playwright/test";
import { launchDesktop, makeUserDataDir, makeWorkspace } from "../helpers/electron-app";

test("switches visible shell language from appearance settings", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("i18n-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: {
      PI_APP_LANGUAGE: "en",
    },
  });

  try {
    const window = await harness.firstWindow();
    await window.waitForFunction(() => document.body.innerText.includes("Settings") || document.body.innerText.includes("设置"), undefined, {
      timeout: 15_000,
    });

    await window.locator(".sidebar__nav-item").filter({ hasText: /Settings|设置/ }).click();
    await window.getByRole("button", { name: /Appearance|外观/ }).click();

    await window.getByRole("radio", { name: "简体中文" }).check();
    await expect(window.getByRole("heading", { name: "外观", exact: true })).toBeVisible();
    await expect(window.locator(".settings-view")).toContainText("语言");

    await window.getByRole("radio", { name: "English" }).check();
    await expect(window.getByRole("heading", { name: "Appearance", exact: true })).toBeVisible();
    await expect(window.locator(".settings-view")).toContainText("Language");
  } finally {
    await harness.close();
  }
});
