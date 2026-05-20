import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PATH_MARKER_START = "__PI_GUI_LOGIN_PATH_START__";
const PATH_MARKER_END = "__PI_GUI_LOGIN_PATH_END__";

export async function hydrateProcessPathFromLoginShell(): Promise<void> {
  if (process.platform === "win32") {
    return;
  }

  const currentPath = process.env.PATH ?? "";
  const loginShellPath = await readLoginShellPath().catch(() => "");
  const fallbackPaths = buildFallbackPathEntries();
  const shellPathEntries = loginShellPath.split(delimiter).filter(Boolean);
  const mergedPath = mergePathEntries([
    ...shellPathEntries,
    ...currentPath.split(delimiter),
    ...fallbackPaths,
  ]);

  if (!mergedPath) {
    return;
  }

  process.env.PATH = mergedPath;
}

async function readLoginShellPath(): Promise<string> {
  for (const shellPath of resolveLoginShellCandidates()) {
    const pathValue = await readPathFromShell(shellPath).catch(() => "");
    if (pathValue) {
      return pathValue;
    }
  }
  return "";
}

async function readPathFromShell(shellPath: string): Promise<string> {
  const { stdout } = await execFileAsync(
    shellPath,
    ["-lic", `printf '${PATH_MARKER_START}%s${PATH_MARKER_END}\\n' "$PATH"`],
    {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    },
  );

  return extractMarkedPath(stdout);
}

function resolveLoginShellCandidates(): string[] {
  const candidates: string[] = [];
  const configuredShell = process.env.SHELL?.trim();
  if (configuredShell && isAbsolute(configuredShell) && existsSync(configuredShell)) {
    candidates.push(configuredShell);
  }

  if (process.platform === "darwin" && existsSync("/bin/zsh")) {
    candidates.push("/bin/zsh");
  }

  if (existsSync("/bin/bash")) {
    candidates.push("/bin/bash");
  }

  return [...new Set(candidates)];
}

function extractMarkedPath(output: string): string {
  const startIndex = output.lastIndexOf(PATH_MARKER_START);
  if (startIndex < 0) {
    return "";
  }
  const valueStart = startIndex + PATH_MARKER_START.length;
  const endIndex = output.indexOf(PATH_MARKER_END, valueStart);
  if (endIndex < 0) {
    return "";
  }
  return output.slice(valueStart, endIndex).trim();
}

function buildFallbackPathEntries(): string[] {
  const home = process.env.HOME?.trim();
  return [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    ...(home
      ? [
          join(home, ".cargo", "bin"),
          join(home, "Library", "pnpm"),
          join(home, ".local", "bin"),
        ]
      : []),
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].filter((entry) => existsSync(entry));
}

function mergePathEntries(entries: readonly string[]): string {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const entry of entries) {
    const normalizedEntry = entry.trim();
    if (!normalizedEntry || seen.has(normalizedEntry)) {
      continue;
    }
    seen.add(normalizedEntry);
    merged.push(normalizedEntry);
  }
  return merged.join(delimiter);
}
