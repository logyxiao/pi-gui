import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  commitAllInGitRepo,
  createNamedThread,
  desktopShortcut,
  getGitHeadCommitMessage,
  initGitRepo,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  setCommitMessageOverride,
} from "../helpers/electron-app";

test("shows workspace file mentions from the composer and inserts the selected file", async () => {
  test.setTimeout(30_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("mention-workspace");
  await initGitRepo(workspacePath);
  await commitAllInGitRepo(workspacePath, "init");
  await mkdir(join(workspacePath, "src"), { recursive: true });
  await writeFile(join(workspacePath, "src", "App.tsx"), "export default App;\n", "utf8");
  await commitAllInGitRepo(workspacePath, "add src");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Mention test");

    const composer = window.getByTestId("composer");
    await composer.click();
    await composer.pressSequentially("@");

    const mentionMenu = window.getByTestId("mention-menu");
    await expect(mentionMenu).toBeVisible();
    await expect(mentionMenu.locator(".mention-menu__item")).toHaveCount(2);

    await composer.pressSequentially("READ");
    await expect(mentionMenu.locator(".mention-menu__item")).toHaveCount(1);
    await expect(mentionMenu.locator(".mention-menu__filename")).toContainText("README.md");

    await composer.press("Tab");
    await expect(mentionMenu).toHaveCount(0);
    await expect(composer).toHaveValue("@README.md ");

    await composer.selectText();
    await composer.press("Backspace");
    await expect(composer).toHaveValue("");
    await composer.pressSequentially("@src");
    await expect(mentionMenu).toBeVisible();
    await composer.press("Escape");
    await expect(mentionMenu).toHaveCount(0);
    await expect(composer).toHaveValue("@src");
  } finally {
    await harness.close();
  }
});

test("toggles the diff panel from the keyboard shortcut and renders changed files on the right", async () => {
  test.setTimeout(30_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("diff-workspace");
  await initGitRepo(workspacePath);
  await commitAllInGitRepo(workspacePath, "init");
  await writeFile(join(workspacePath, "README.md"), "# diff-workspace\nnew line\n", "utf8");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Diff test");

    const diffPanel = window.locator(".diff-panel");
    await expect(diffPanel).toHaveCount(0);

    await window.keyboard.press(desktopShortcut("D"));
    await expect(diffPanel).toBeVisible();
    await expect(diffPanel.locator(".diff-panel__title")).not.toHaveText("");
    await expect(diffPanel.locator(".diff-panel__file-name")).toContainText("README.md");

    const mainBox = await window.locator(".main").boundingBox();
    const panelBox = await diffPanel.boundingBox();
    expect(mainBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect((panelBox?.x ?? 0)).toBeGreaterThan((mainBox?.x ?? 0) + (mainBox?.width ?? 0) / 2);

    await diffPanel.locator(".diff-panel__file-name").click();
    await expect(diffPanel.locator(".diff-inline")).toBeVisible();
    await expect(diffPanel.locator(".diff-line--added")).toHaveCount(1);

    await writeFile(join(workspacePath, "README.md"), "# diff-workspace\nnew line\nanother line\n", "utf8");
    await expect(diffPanel.locator(".diff-line--added")).toHaveCount(2);

    await window.keyboard.press(desktopShortcut("D"));
    await expect(diffPanel).toHaveCount(0);
  } finally {
    await harness.close();
  }
});

test("stages, generates a commit message, and commits staged changes from the Changes panel", async () => {
  test.setTimeout(45_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("git-panel-workspace");
  await initGitRepo(workspacePath);
  await commitAllInGitRepo(workspacePath, "init");
  await writeFile(join(workspacePath, "README.md"), "# git-panel-workspace\nnew line\n", "utf8");
  await mkdir(join(workspacePath, "src"), { recursive: true });
  await writeFile(join(workspacePath, "src", "note.ts"), "export const note = 1;\n", "utf8");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await setCommitMessageOverride(harness, "Add generated git panel changes");
    await createNamedThread(window, "Git panel test");
    await window.keyboard.press(desktopShortcut("D"));

    const diffPanel = window.locator(".diff-panel");
    await expect(diffPanel).toBeVisible();
    const stagedSection = diffPanel.locator(".diff-panel__section").first();
    const unstagedSection = diffPanel.locator(".diff-panel__section").nth(1);
    await expect(unstagedSection).toBeVisible();

    await unstagedSection.locator(".diff-panel__section-action").click();
    await expect(stagedSection.locator(".diff-panel__stage-btn").first()).toHaveAttribute("aria-label", /README\.md|note\.ts/);
    await expect(stagedSection.locator(".diff-panel__file")).toHaveCount(2);
    await expect(stagedSection.locator(".diff-panel__file-name").filter({ hasText: "src/note.ts" })).toHaveCount(1);
    await expect(unstagedSection.locator(".diff-panel__file")).toHaveCount(0);

    await diffPanel.locator(".diff-panel__generate-btn").click();
    const commitInput = diffPanel.locator(".diff-panel__commit-input");
    await expect(commitInput).toHaveValue("Add generated git panel changes");

    await commitInput.fill("Add git panel test changes");
    await diffPanel.locator(".diff-panel__commit-btn").click();

    await expect(diffPanel.locator(".diff-panel__empty")).toBeVisible();
    await expect(stagedSection.locator(".diff-panel__file")).toHaveCount(0);
    await expect(diffPanel.locator(".diff-panel__history")).toContainText("Add git panel test changes");

    await expect(getGitHeadCommitMessage(workspacePath)).resolves.toBe("Add git panel test changes");
  } finally {
    await harness.close();
  }
});
