import { expect, test } from "@playwright/test";
import { join } from "node:path";
import {
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  seedMarkdownTranscriptFixture,
  selectSession,
} from "../helpers/electron-app";

test("renders assistant markdown from restored transcript content parts", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("markdown-rendering-workspace");
  await seedAgentDir(agentDir);
  await seedMarkdownTranscriptFixture(agentDir, workspacePath);

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await selectSession(window, "Markdown fixture session");

    const assistantMessage = window.locator(".timeline-item--assistant", { hasText: "Markdown heading" });
    await expect(assistantMessage.locator("h1", { hasText: "Markdown heading" })).toBeVisible();
    await expect(assistantMessage.locator("li", { hasText: "First item" })).toBeVisible();
    await expect(assistantMessage.locator("pre code", { hasText: "const value = 1;" })).toBeVisible();
  } finally {
    await harness.close();
  }
});
