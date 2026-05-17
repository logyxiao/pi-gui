import { execFile } from "node:child_process";
import path from "node:path";
import type { PiSdkDriver } from "@pi-gui/pi-sdk-driver";
import type { SessionModelSelection, WorkspaceRef } from "@pi-gui/session-driver";

function validateFilePath(workspacePath: string, filePath: string): string {
  const resolved = path.resolve(workspacePath, filePath);
  if (!resolved.startsWith(workspacePath + path.sep) && resolved !== workspacePath) {
    throw new Error("Path escapes workspace");
  }
  return filePath;
}

export interface ChangedFileEntry {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted" | "untracked";
  readonly staged: boolean;
  readonly unstaged: boolean;
  readonly indexStatus: string;
  readonly worktreeStatus: string;
}

export interface GitCommitEntry {
  readonly hash: string;
  readonly subject: string;
  readonly author: string;
  readonly relativeTime: string;
  readonly refs: readonly string[];
}

export interface GitSyncStatus {
  readonly ahead: number;
  readonly behind: number;
  readonly hasUpstream: boolean;
}

export interface GenerateCommitMessageInput {
  readonly workspace: WorkspaceRef;
  readonly driver: PiSdkDriver;
  readonly model?: SessionModelSelection;
  readonly thinkingLevel?: string;
}

export function getChangedFiles(workspacePath: string): Promise<ChangedFileEntry[]> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      { cwd: workspacePath, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }
        const entries: ChangedFileEntry[] = [];
        const records = stdout.split("\0").filter(Boolean);
        for (let index = 0; index < records.length; index += 1) {
          const record = records[index] ?? "";
          if (!record.trim()) {
            continue;
          }
          const xy = record.slice(0, 2);
          const x = xy[0] ?? " ";
          const y = xy[1] ?? " ";
          const rawPath = record.slice(3);
          const filePath = x === "R" || x === "C" ? records[++index] ?? rawPath : rawPath;
          entries.push({
            path: filePath,
            status: parseStatus(xy),
            staged: hasStagedChanges(xy),
            unstaged: hasUnstagedChanges(xy),
            indexStatus: x,
            worktreeStatus: y,
          });
        }
        resolve(entries);
      },
    );
  });
}

export function getFileDiff(workspacePath: string, filePath: string, staged = false): Promise<string> {
  validateFilePath(workspacePath, filePath);
  if (staged) {
    return runGitDiff(workspacePath, ["diff", "--cached", "--", filePath]);
  }

  return new Promise((resolve) => {
    execFile(
      "git",
      ["diff", "--", filePath],
      { cwd: workspacePath, maxBuffer: 5 * 1024 * 1024 },
      (error, stdout) => {
        if (error || !stdout.trim()) {
          // Try staged diff
          execFile(
            "git",
            ["diff", "--cached", "--", filePath],
            { cwd: workspacePath, maxBuffer: 5 * 1024 * 1024 },
            (error2, stdout2) => {
              if (!error2 && stdout2.trim()) {
                resolve(stdout2);
                return;
              }
              // Untracked file — show content as all-additions diff
              execFile(
                "git",
                ["diff", "--no-index", "--", "/dev/null", filePath],
                { cwd: workspacePath, maxBuffer: 5 * 1024 * 1024 },
                (_error3, stdout3) => {
                  // git diff --no-index exits 1 when files differ, which is expected
                  resolve(stdout3 || "");
                },
              );
            },
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export function stageFile(workspacePath: string, filePath: string): Promise<void> {
  validateFilePath(workspacePath, filePath);
  return runGit(workspacePath, ["add", "--", filePath]);
}

export function unstageFile(workspacePath: string, filePath: string): Promise<void> {
  validateFilePath(workspacePath, filePath);
  return runGit(workspacePath, ["restore", "--staged", "--", filePath]);
}

export function stageAllFiles(workspacePath: string): Promise<void> {
  return runGit(workspacePath, ["add", "-A"]);
}

export function unstageAllFiles(workspacePath: string): Promise<void> {
  return runGit(workspacePath, ["restore", "--staged", "."]);
}

export function commitStagedChanges(workspacePath: string, message: string): Promise<void> {
  const normalizedMessage = message.trim();
  if (!normalizedMessage) {
    throw new Error("Commit message is required");
  }
  return runGit(workspacePath, ["commit", "-m", normalizedMessage]);
}

export function pushGitChanges(workspacePath: string): Promise<void> {
  return runGit(workspacePath, ["push"]);
}

export async function generateCommitMessage(input: GenerateCommitMessageInput): Promise<string> {
  const nameStatus = await getStagedNameStatus(input.workspace.path);
  if (!nameStatus.trim()) {
    return "";
  }
  const diff = await getStagedDiff(input.workspace.path);
  const generated = await input.driver.generateCommitMessage(input.workspace, {
    nameStatus,
    diff,
    ...(input.model ? { model: input.model } : {}),
    ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
  });
  if (generated?.trim()) {
    return generated.trim();
  }
  return generateFallbackCommitMessage(nameStatus);
}

export function getCommitHistory(workspacePath: string, limit = 24): Promise<GitCommitEntry[]> {
  const count = String(Math.max(1, Math.min(limit, 100)));
  return runGitStdout(workspacePath, [
    "log",
    `--max-count=${count}`,
    "--date=relative",
    "--pretty=format:%h%x1f%D%x1f%cr%x1f%an%x1f%s%x1e",
  ]).then((stdout) =>
    stdout
      .split("\x1e")
      .map((record) => record.trim())
      .filter(Boolean)
      .map((record) => {
        const [hash = "", refsRaw = "", relativeTime = "", author = "", subject = ""] = record.split("\x1f");
        return {
          hash,
          subject,
          author,
          relativeTime,
          refs: refsRaw
            .split(",")
            .map((ref) => ref.trim())
            .filter(Boolean),
        };
      }),
  ).catch(() => []);
}

export async function getGitSyncStatus(workspacePath: string): Promise<GitSyncStatus> {
  try {
    const stdout = await runGitStdout(workspacePath, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]);
    const [behindRaw = "0", aheadRaw = "0"] = stdout.trim().split(/\s+/);
    return {
      ahead: Number.parseInt(aheadRaw, 10) || 0,
      behind: Number.parseInt(behindRaw, 10) || 0,
      hasUpstream: true,
    };
  } catch {
    return {
      ahead: 0,
      behind: 0,
      hasUpstream: false,
    };
  }
}

function getStagedNameStatus(workspacePath: string): Promise<string> {
  return runGitStdout(workspacePath, ["diff", "--cached", "--name-status"]);
}

function getStagedDiff(workspacePath: string): Promise<string> {
  return runGitStdout(workspacePath, ["diff", "--cached"]);
}

function generateFallbackCommitMessage(nameStatus: string): string {
  const files = nameStatus
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/).at(-1) ?? "")
    .filter(Boolean);

  if (files.length === 0) {
    return "";
  }

  const firstFile = files[0] ?? "";
  const primary = summarizePath(firstFile);
  const type = inferConventionalCommitType(nameStatus, files);
  if (files.length === 1) {
    return `${type}: ${summarizeFallbackSubject(nameStatus, primary)}`;
  }

  const scope = summarizeSharedScope(files) ?? `${files.length} files`;
  return `${type}: ${summarizeFallbackSubject(nameStatus, scope)}`;
}

function runGit(workspacePath: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [...args],
      { cwd: workspacePath },
      (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      },
    );
  });
}

function runGitStdout(workspacePath: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [...args],
      { cwd: workspacePath, maxBuffer: 5 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function runGitDiff(workspacePath: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "git",
      [...args],
      { cwd: workspacePath, maxBuffer: 5 * 1024 * 1024 },
      (error, stdout) => {
        resolve(error ? "" : stdout);
      },
    );
  });
}

function parseStatus(xy: string): ChangedFileEntry["status"] {
  const x = xy[0] ?? " ";
  const y = xy[1] ?? " ";

  if (x === "?" && y === "?") {
    return "untracked";
  }
  if (x === "A" || y === "A") {
    return "added";
  }
  if (x === "D" || y === "D") {
    return "deleted";
  }
  return "modified";
}

function hasStagedChanges(xy: string): boolean {
  const x = xy[0] ?? " ";
  return x !== "?" && x !== " ";
}

function hasUnstagedChanges(xy: string): boolean {
  const x = xy[0] ?? " ";
  const y = xy[1] ?? " ";
  return x === "?" || y !== " ";
}

function summarizeFallbackSubject(nameStatus: string, scope: string): string {
  const statuses = nameStatus
    .split("\n")
    .map((line) => line.trim().slice(0, 1))
    .filter(Boolean);
  if (statuses.length > 0 && statuses.every((status) => status === "A")) {
    return `add ${scope}`;
  }
  if (statuses.length > 0 && statuses.every((status) => status === "D")) {
    return `remove ${scope}`;
  }
  return `update ${scope}`;
}

function inferConventionalCommitType(nameStatus: string, files: readonly string[]): string {
  if (files.length > 0 && files.every((file) => /(^|\/)(test|tests|__tests__)\/|(\.|-)(test|spec)\.[cm]?[jt]sx?$/i.test(file))) {
    return "test";
  }
  if (files.length > 0 && files.every((file) => /\.(md|mdx|txt|rst)$/i.test(file))) {
    return "docs";
  }
  if (files.length > 0 && files.every((file) => /(^|\/)(package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|vite\.config|tsconfig|electron-builder|build|scripts)\b/i.test(file))) {
    return "build";
  }
  const statuses = nameStatus
    .split("\n")
    .map((line) => line.trim().slice(0, 1))
    .filter(Boolean);
  if (statuses.length > 0 && statuses.every((status) => status === "D")) {
    return "chore";
  }
  return "feat";
}

function summarizePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const fileName = parts.at(-1) ?? normalized;
  const stem = fileName.replace(/\.[^.]+$/, "");
  return stem.replace(/[-_]+/g, " ");
}

function summarizeSharedScope(files: readonly string[]): string | null {
  const firstParts = files[0]?.replace(/\\/g, "/").split("/").filter(Boolean) ?? [];
  if (firstParts.length <= 1) {
    return null;
  }
  let shared = firstParts.slice(0, -1);
  for (const file of files.slice(1)) {
    const parts = file.replace(/\\/g, "/").split("/").filter(Boolean).slice(0, -1);
    let length = 0;
    while (length < shared.length && shared[length] === parts[length]) {
      length += 1;
    }
    shared = shared.slice(0, length);
  }
  return shared.at(-1)?.replace(/[-_]+/g, " ") ?? null;
}
