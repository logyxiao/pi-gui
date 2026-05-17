import {
  SessionManager,
  SettingsManager,
  createExtensionRuntime,
  createAgentSession,
  type CreateAgentSessionOptions,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import type { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { SessionModelSelection, WorkspaceRef } from "@pi-gui/session-driver";
import { messageText as sessionMessageText } from "./session-supervisor-utils.js";

export interface GenerateCommitMessageOptions {
  readonly diff: string;
  readonly nameStatus: string;
  readonly model?: SessionModelSelection;
  readonly thinkingLevel?: string;
  readonly signal?: AbortSignal;
}

interface CommitMessageGeneratorDeps {
  readonly agentDir: string;
  readonly authStorage: AuthStorage;
  readonly modelRegistry: ModelRegistry;
}

const MAX_DIFF_CHARS = 20000;
const MAX_COMMIT_MESSAGE_LENGTH = 96;
const COMMIT_MESSAGE_SYSTEM_PROMPT = [
  "You write concise git commit messages for a coding assistant desktop app.",
  "Return only the commit message subject.",
  "Use Conventional Commits format: type: subject.",
  "Prefer one of: feat, fix, refactor, perf, docs, test, build, ci, chore, style, revert.",
  "Use imperative mood.",
  "Keep it under 72 characters when possible.",
  "Use the same language as the changed code context when obvious.",
  "No markdown, quotes, labels, code fences, bullets, or trailing punctuation.",
].join("\n");

export async function generateCommitMessage(
  workspace: WorkspaceRef,
  options: GenerateCommitMessageOptions,
  deps: CommitMessageGeneratorDeps,
): Promise<string | null> {
  const nameStatus = options.nameStatus.trim();
  const diff = options.diff.trim();
  if ((!nameStatus && !diff) || options.signal?.aborted) {
    return null;
  }

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false },
  });
  const resourceLoader = createCommitMessageResourceLoader();

  const createOptions: CreateAgentSessionOptions = {
    cwd: workspace.path,
    agentDir: deps.agentDir,
    authStorage: deps.authStorage,
    modelRegistry: deps.modelRegistry,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.inMemory(),
    tools: [],
  };
  if (options.model) {
    const selectedModel = deps.modelRegistry.find(options.model.provider, options.model.modelId);
    if (!selectedModel) {
      return null;
    }
    createOptions.model = selectedModel;
  }
  if (options.thinkingLevel) {
    createOptions.thinkingLevel = options.thinkingLevel as NonNullable<CreateAgentSessionOptions["thinkingLevel"]>;
  }

  const { session } = await createAgentSession(createOptions);
  const handleAbort = () => {
    void session.abort().catch(() => undefined);
  };
  options.signal?.addEventListener("abort", handleAbort, { once: true });
  try {
    if (options.signal?.aborted || !session.model) {
      return null;
    }
    const auth = await session.modelRegistry.getApiKeyAndHeaders(session.model);
    if (!auth.ok || !auth.apiKey) {
      return null;
    }

    await session.prompt(buildCommitPrompt(nameStatus, diff), { source: "interactive" });
    return normalizeCommitMessage(extractLastAssistantText(session), nameStatus);
  } finally {
    options.signal?.removeEventListener("abort", handleAbort);
    session.dispose();
  }
}

function createCommitMessageResourceLoader(): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => COMMIT_MESSAGE_SYSTEM_PROMPT,
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

function buildCommitPrompt(nameStatus: string, diff: string): string {
  const clippedDiff = diff.length > MAX_DIFF_CHARS
    ? `${diff.slice(0, MAX_DIFF_CHARS)}\n\n[diff truncated]`
    : diff;
  return [
    "Generate a git commit message subject for the staged changes.",
    "Use Conventional Commits format, for example: feat: add workspace sync button or fix: handle push errors.",
    "Choose the most specific type from: feat, fix, refactor, perf, docs, test, build, ci, chore, style, revert.",
    "Return only the subject line.",
    "",
    "<name_status>",
    nameStatus,
    "</name_status>",
    "",
    "<staged_diff>",
    clippedDiff,
    "</staged_diff>",
  ].join("\n");
}

function extractLastAssistantText(session: { messages: readonly unknown[] }): string {
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index];
    if (!isRecord(message) || message.role !== "assistant") {
      continue;
    }
    return sessionMessageText(message);
  }
  return "";
}

function normalizeCommitMessage(message: string, nameStatus: string): string | null {
  let normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  normalized = normalized.replace(/^(commit message|message|subject)\s*:\s*/i, "").trim();
  normalized = stripWrappingQuotes(normalized);
  normalized = normalized.replace(/[.?!,:;]+$/g, "").trim();
  if (!normalized) {
    return null;
  }
  if (!hasConventionalCommitPrefix(normalized)) {
    normalized = `${inferConventionalCommitType(nameStatus)}: ${lowercaseFirstWord(normalized)}`;
  }
  if (normalized.length > MAX_COMMIT_MESSAGE_LENGTH) {
    normalized = normalized.slice(0, MAX_COMMIT_MESSAGE_LENGTH).trimEnd();
  }
  return normalized || null;
}

function hasConventionalCommitPrefix(value: string): boolean {
  return /^(feat|fix|refactor|perf|docs|test|build|ci|chore|style|revert)(\([^)]+\))?!?:\s+\S/i.test(value);
}

function inferConventionalCommitType(nameStatus: string): string {
  const files = nameStatus
    .split("\n")
    .map((line) => line.trim().split(/\s+/).at(-1) ?? "")
    .filter(Boolean);
  if (files.length > 0 && files.every((file) => /(^|\/)(test|tests|__tests__)\/|(\.|-)(test|spec)\.[cm]?[jt]sx?$/i.test(file))) {
    return "test";
  }
  if (files.length > 0 && files.every((file) => /\.(md|mdx|txt|rst)$/i.test(file))) {
    return "docs";
  }
  if (files.length > 0 && files.every((file) => /(^|\/)(package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|vite\.config|tsconfig|electron-builder|build|scripts)\b/i.test(file))) {
    return "build";
  }
  return "feat";
}

function lowercaseFirstWord(value: string): string {
  return value.replace(/^([A-Z][A-Z0-9-]*)(\b)/, (match) => match.toLowerCase());
}

function stripWrappingQuotes(value: string): string {
  let current = value.trim();
  while (current.length >= 2) {
    const first = current[0];
    const last = current[current.length - 1];
    if (
      (first === "\"" && last === "\"") ||
      (first === "'" && last === "'") ||
      (first === "`" && last === "`")
    ) {
      current = current.slice(1, -1).trim();
      continue;
    }
    break;
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
