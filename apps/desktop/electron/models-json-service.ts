import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ModelsJsonModelConfig {
  readonly id: string;
  readonly name?: string;
  readonly api?: string;
  readonly enabled?: boolean;
  readonly reasoning?: boolean;
  readonly input?: readonly string[];
  readonly contextWindow?: number;
  readonly maxTokens?: number;
}

export interface ModelsJsonProviderConfig {
  readonly baseUrl?: string;
  readonly api?: string;
  readonly apiKey?: string;
  readonly authHeader?: boolean;
  readonly headers?: Record<string, string>;
  readonly balanceBaseUrl?: string;
  readonly balanceApiKey?: string;
  readonly enabled?: boolean;
  readonly models?: readonly ModelsJsonModelConfig[];
}

export interface ModelsJsonFile {
  readonly providers: Record<string, ModelsJsonProviderConfig>;
}

export interface ProviderEndpointProbeInput {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly headers?: Record<string, string>;
  readonly authHeader?: boolean;
}

export interface ProviderProbeResult {
  readonly status: "ok" | "error";
  readonly modelCount: number;
  readonly url: string;
  readonly latencyMs: number;
  readonly detail: string;
  readonly models?: readonly string[];
  readonly balance?: string;
  readonly balanceSource?: string;
}

export interface ModelsJsonSaveResult {
  readonly path: string;
  readonly content: string;
  readonly providerCount: number;
  readonly modelCount: number;
  readonly enabledCount: number;
}

export function getModelsJsonPath(): string {
  return join(getAgentDir(), "models.json");
}

function getAgentDir(): string {
  return process.env.PI_AGENT_DIR || join(homedir(), ".pi", "agent");
}

export async function readModelsJson(): Promise<ModelsJsonFile> {
  const path = getModelsJsonPath();
  try {
    const raw = await readFile(path, "utf8");
    return normalizeModelsJson(JSON.parse(stripJsonCommentsAndTrailingCommas(raw)) as unknown);
  } catch (error) {
    if (isMissingFileError(error)) {
      return { providers: {} };
    }
    throw error;
  }
}

export async function writeModelsJson(payload: ModelsJsonFile): Promise<ModelsJsonSaveResult> {
  const path = getModelsJsonPath();
  await mkdir(join(getAgentDir()), { recursive: true });
  const normalized = normalizeModelsJson(payload);
  const content = `${JSON.stringify(normalized, null, 2)}\n`;
  await writeFile(path, content, "utf8");
  const providerCount = Object.keys(normalized.providers).length;
  const modelCount = Object.values(normalized.providers).reduce((count, provider) => count + (provider.models?.length ?? 0), 0);
  const enabledCount = Object.values(normalized.providers).reduce((count, provider) => count + (provider.enabled === false ? 0 : 1), 0);
  return { path, content, providerCount, modelCount, enabledCount };
}

export function normalizeModelsJson(input: unknown): ModelsJsonFile {
  if (!input || typeof input !== "object") {
    return { providers: {} };
  }
  const candidate = input as { providers?: unknown };
  const providers = candidate.providers && typeof candidate.providers === "object" ? candidate.providers as Record<string, unknown> : {};
  const nextProviders: Record<string, ModelsJsonProviderConfig> = {};
  for (const [providerId, providerValue] of Object.entries(providers)) {
    if (!providerValue || typeof providerValue !== "object") continue;
    const provider = providerValue as Record<string, unknown>;
    const models = Array.isArray(provider.models)
      ? provider.models.flatMap((modelValue) => normalizeModelConfig(modelValue)).filter(Boolean)
      : undefined;
    nextProviders[providerId] = {
      ...(typeof provider.baseUrl === "string" ? { baseUrl: provider.baseUrl } : {}),
      ...(typeof provider.api === "string" ? { api: provider.api } : {}),
      ...(typeof provider.apiKey === "string" ? { apiKey: provider.apiKey } : {}),
      ...(typeof provider.authHeader === "boolean" ? { authHeader: provider.authHeader } : {}),
      ...(provider.headers && typeof provider.headers === "object" ? { headers: normalizeStringRecord(provider.headers) } : {}),
      ...(typeof provider.balanceBaseUrl === "string" ? { balanceBaseUrl: provider.balanceBaseUrl } : {}),
      ...(typeof provider.balanceApiKey === "string" ? { balanceApiKey: provider.balanceApiKey } : {}),
      ...(typeof provider.enabled === "boolean" ? { enabled: provider.enabled } : {}),
      ...(models && models.length > 0 ? { models } : {}),
    };
  }
  return { providers: nextProviders };
}

export function computeEnabledModelPatterns(modelsJson: ModelsJsonFile): string[] {
  const enabled: string[] = [];
  for (const [providerId, provider] of Object.entries(modelsJson.providers)) {
    if (provider.enabled === false) continue;
    const models = provider.models ?? [];
    const enabledModels = models.filter((model) => model.enabled !== false).map((model) => `${providerId}/${model.id}`);
    if (enabledModels.length === 0) {
      enabled.push(`${providerId}/*`);
      continue;
    }
    enabled.push(...enabledModels);
  }
  return enabled;
}

export async function syncEnabledModelsToSettings(modelsJson: ModelsJsonFile): Promise<string[]> {
  const patterns = computeEnabledModelPatterns(modelsJson);
  const path = join(getAgentDir(), "settings.json");
  let settings: Record<string, unknown> = {};
  try {
    const raw = await readFile(path, "utf8");
    settings = JSON.parse(stripJsonCommentsAndTrailingCommas(raw)) as Record<string, unknown>;
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
  settings.enabledModels = patterns;
  await mkdir(join(getAgentDir()), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return patterns;
}

export async function fetchProviderModels(input: ProviderEndpointProbeInput): Promise<ProviderProbeResult> {
  const startedAt = Date.now();
  const { urls, url } = buildCandidateUrls(input.baseUrl);
  let lastError: unknown;
  for (const candidate of urls) {
    try {
      const response = await fetch(candidate, { headers: buildHeaders(input) });
      const latencyMs = Date.now() - startedAt;
      if (!response.ok) {
        lastError = `${response.status} ${response.statusText}`;
        continue;
      }
      const parsed = (await response.json()) as unknown;
      const models = extractModelIds(parsed);
      if (models.length === 0) {
        return { status: "error", modelCount: 0, url: candidate, latencyMs, detail: "JSON parsed but no models found" };
      }
      return { status: "ok", modelCount: models.length, url: candidate, latencyMs, detail: "provider models responded", models };
    } catch (error) {
      lastError = error;
    }
  }
  return {
    status: "error",
    modelCount: 0,
    url,
    latencyMs: Date.now() - startedAt,
    detail: describeError(lastError) ?? "request failed",
  };
}

export async function testProvider(input: ProviderEndpointProbeInput): Promise<ProviderProbeResult> {
  return fetchProviderModels(input);
}

export async function probeProvider(input: ProviderEndpointProbeInput & { readonly balanceBaseUrl?: string; readonly balanceApiKey?: string }): Promise<ProviderProbeResult> {
  const modelProbe = await fetchProviderModels(input);
  if (modelProbe.status !== "ok") {
    return modelProbe;
  }
  const balanceSource = input.balanceBaseUrl || input.baseUrl;
  const balanceCandidates = [
    joinUrl(balanceSource, "/balance"),
    joinUrl(balanceSource, "/v1/balance"),
    joinUrl(balanceSource, "/dashboard/billing/credit_grants"),
  ];
  for (const candidate of balanceCandidates) {
    try {
      const response = await fetch(candidate, { headers: buildHeaders({ ...input, baseUrl: input.balanceBaseUrl ?? input.baseUrl, apiKey: input.balanceApiKey ?? input.apiKey }) });
      if (!response.ok) continue;
      const text = await response.text();
      return {
        ...modelProbe,
        balance: summarizeBalance(text),
        balanceSource: candidate,
        detail: `${modelProbe.detail}; balance probe responded`,
      };
    } catch {
      continue;
    }
  }
  return {
    ...modelProbe,
    detail: `${modelProbe.detail}; no balance endpoint detected`,
  };
}

function buildCandidateUrls(baseUrl: string): { readonly urls: string[]; readonly url: string } {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  const candidates = ["/models", "/v1/models", "/api/v1/models"].map((suffix) => joinUrl(trimmed, suffix));
  return { urls: [...new Set(candidates)], url: candidates[0] ?? trimmed };
}

function joinUrl(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
}

function buildHeaders(input: ProviderEndpointProbeInput): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(input.headers ?? {}),
  };
  const apiKey = input.apiKey?.trim();
  if (apiKey) {
    headers[input.authHeader === false ? "X-API-Key" : "Authorization"] = input.authHeader === false ? apiKey : `Bearer ${apiKey}`;
  }
  return headers;
}

function extractModelIds(parsed: unknown): string[] {
  const candidates: unknown[] = [];
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.data)) candidates.push(...record.data);
    if (Array.isArray(record.models)) candidates.push(...record.models);
  }
  return [...new Set(candidates.flatMap((item) => extractModelId(item)).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));
}

function extractModelId(item: unknown): string | undefined {
  if (!item || typeof item !== "object") return undefined;
  const record = item as Record<string, unknown>;
  if (typeof record.id === "string") return record.id;
  if (typeof record.model === "string") return record.model;
  if (typeof record.name === "string") return record.name;
  return undefined;
}

function normalizeModelConfig(value: unknown): ModelsJsonModelConfig[] {
  if (!value || typeof value !== "object") return [];
  const model = value as Record<string, unknown>;
  const id = typeof model.id === "string" ? model.id.trim() : "";
  if (!id) return [];
  return [{
    id,
    ...(typeof model.name === "string" ? { name: model.name } : {}),
    ...(typeof model.api === "string" ? { api: model.api } : {}),
    ...(typeof model.enabled === "boolean" ? { enabled: model.enabled } : {}),
    ...(typeof model.reasoning === "boolean" ? { reasoning: model.reasoning } : {}),
    ...(Array.isArray(model.input) ? { input: model.input.filter((entry): entry is string => typeof entry === "string") } : {}),
    ...(typeof model.contextWindow === "number" ? { contextWindow: model.contextWindow } : {}),
    ...(typeof model.maxTokens === "number" ? { maxTokens: model.maxTokens } : {}),
  }];
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string") {
      result[key] = raw;
    }
  }
  return result;
}

function stripJsonCommentsAndTrailingCommas(input: string): string {
  let output = "";
  let inString = false;
  let stringQuote = "";
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];
    if (inString) {
      output += char;
      if (char === "\\") {
        output += next ?? "";
        i += 1;
        continue;
      }
      if (char === stringQuote) {
        inString = false;
        stringQuote = "";
      }
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      stringQuote = char;
      output += char;
      continue;
    }
    if (char === "/" && next === "/") {
      while (i < input.length && input[i] !== "\n") i += 1;
      output += "\n";
      continue;
    }
    if (char === "/" && next === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i += 1;
      i += 1;
      continue;
    }
    output += char;
  }
  return output.replace(/,\s*([}\]])/g, "$1");
}

function describeError(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return undefined;
}

function summarizeBalance(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "ok";
  return trimmed.slice(0, 120);
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "ENOENT");
}
