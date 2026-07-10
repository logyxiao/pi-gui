import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ModelsJsonOpenAiProviderToolsCompat {
  readonly enabled?: boolean;
  readonly imageGeneration?: boolean;
  readonly outputDirectory?: string;
}

export interface ModelsJsonCompat {
  readonly supportsDeveloperRole?: boolean;
  readonly supportsReasoningEffort?: boolean;
  readonly openaiProviderTools?: ModelsJsonOpenAiProviderToolsCompat;
}

export interface ModelsJsonModelConfig {
  readonly id: string;
  readonly name?: string;
  readonly api?: string;
  readonly enabled?: boolean;
  readonly reasoning?: boolean;
  readonly input?: readonly string[];
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly compat?: ModelsJsonCompat;
}

export interface ModelsJsonProviderConfig {
  readonly baseUrl?: string;
  readonly api?: string;
  readonly apiKey?: string;
  readonly authHeader?: boolean;
  readonly headers?: Record<string, string>;
  readonly balanceBaseUrl?: string;
  readonly balanceApiKey?: string;
  readonly usageScript?: string;
  readonly usageLastValue?: string;
  readonly usageLastCheckedAt?: string;
  readonly enabled?: boolean;
  readonly compat?: ModelsJsonCompat;
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
    const providerCompat = normalizeCompat(provider.compat);
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
      ...(typeof provider.usageScript === "string" ? { usageScript: provider.usageScript } : {}),
      ...(typeof provider.usageLastValue === "string" ? { usageLastValue: provider.usageLastValue } : {}),
      ...(typeof provider.usageLastCheckedAt === "string" ? { usageLastCheckedAt: provider.usageLastCheckedAt } : {}),
      ...(typeof provider.enabled === "boolean" ? { enabled: provider.enabled } : {}),
      ...(providerCompat ? { compat: providerCompat } : {}),
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
  const runtimePatterns = Array.isArray(settings.enabledModels)
    ? settings.enabledModels.filter((pattern): pattern is string => typeof pattern === "string" && pattern.startsWith("cc-switch-"))
    : [];
  settings.enabledModels = [...new Set([...patterns, ...runtimePatterns])];
  await mkdir(join(getAgentDir()), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return settings.enabledModels as string[];
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

export async function probeProvider(input: ProviderEndpointProbeInput & { readonly balanceBaseUrl?: string; readonly balanceApiKey?: string; readonly usageScript?: string }): Promise<ProviderProbeResult> {
  const modelProbe = await fetchProviderModels(input);
  if (modelProbe.status !== "ok") {
    return modelProbe;
  }
  const usageProbe = await runUsageProbe(input);
  if (usageProbe) {
    return {
      ...modelProbe,
      balance: usageProbe.value,
      balanceSource: usageProbe.url,
      detail: `${modelProbe.detail}; usage query responded`,
    };
  }
  return {
    ...modelProbe,
    detail: `${modelProbe.detail}; no usage query configured`,
  };
}

async function runUsageProbe(input: ProviderEndpointProbeInput & { readonly balanceBaseUrl?: string; readonly balanceApiKey?: string; readonly usageScript?: string }): Promise<{ readonly value: string; readonly url: string } | undefined> {
  const scriptConfig = parseUsageScript(input.usageScript);
  const explicitBalanceUrl = input.balanceBaseUrl?.trim();
  const url = scriptConfig?.request.url ?? explicitBalanceUrl;
  if (!url) return undefined;
  const apiKey = input.balanceApiKey ?? input.apiKey ?? "";
  const renderedUrl = interpolateUsageTemplate(url, input.baseUrl, apiKey);
  const headers = {
    ...buildHeaders({ ...input, apiKey }),
    ...(scriptConfig?.request.headers ? renderUsageHeaders(scriptConfig.request.headers, input.baseUrl, apiKey) : {}),
  };
  const response = await fetch(renderedUrl, {
    method: scriptConfig?.request.method ?? "GET",
    headers,
    ...(scriptConfig?.request.body ? { body: interpolateUsageTemplate(scriptConfig.request.body, input.baseUrl, apiKey) } : {}),
  });
  if (!response.ok) return undefined;
  const text = await response.text();
  const parsed = tryParseJson(text) ?? text;
  const extracted = scriptConfig?.extractor ? runUsageExtractor(scriptConfig.extractor, parsed) : undefined;
  return { value: summarizeUsageResult(extracted ?? parsed), url: renderedUrl };
}

interface ParsedUsageScript {
  readonly request: {
    readonly url: string;
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
  };
  readonly extractor?: string;
}

export function parseUsageScript(script: string | undefined): ParsedUsageScript | undefined {
  if (!script?.trim()) return undefined;
  const url = /url\s*:\s*["'`]([^"'`]+)["'`]/.exec(script)?.[1];
  if (!url) return undefined;
  const method = /method\s*:\s*["'`]([^"'`]+)["'`]/.exec(script)?.[1];
  const body = /body\s*:\s*["'`]([^"'`]+)["'`]/.exec(script)?.[1];
  const headersBlock = /headers\s*:\s*\{([\s\S]*?)\}/.exec(script)?.[1];
  const headers: Record<string, string> = {};
  if (headersBlock) {
    for (const match of headersBlock.matchAll(/["'`]([^"'`]+)["'`]\s*:\s*["'`]([^"'`]+)["'`]/g)) {
      headers[match[1] ?? ""] = match[2] ?? "";
    }
  }
  const extractorMatch =
    /extractor(?:Path)?\s*:\s*["'`]([^"'`]+)["'`]/.exec(script) ??
    /path\s*:\s*["'`]([^"'`]+)["'`]/.exec(script);
  return { request: { url, ...(method ? { method } : {}), ...(Object.keys(headers).length > 0 ? { headers } : {}), ...(body ? { body } : {}) }, ...(extractorMatch?.[1] ? { extractor: extractorMatch[1] } : {}) };
}

function renderUsageHeaders(headers: Record<string, string>, baseUrl: string, apiKey: string): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, interpolateUsageTemplate(value, baseUrl, apiKey)]));
}

function interpolateUsageTemplate(template: string, baseUrl: string, apiKey: string): string {
  return template.replaceAll("{{baseUrl}}", baseUrl.replace(/\/+$/, "")).replaceAll("{{apiKey}}", apiKey);
}

function runUsageExtractor(extractor: string, response: unknown): unknown {
  return readJsonPath(response, extractor);
}

function readJsonPath(value: unknown, path: string): unknown {
  const parts = path
    .trim()
    .replace(/^\$\.?/, "")
    .split(/[.[\]]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
      continue;
    }
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function summarizeUsageResult(result: unknown): string {
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    const remaining = firstNumericLikeValue(record, ["remaining", "remain", "available", "available_balance", "availableBalance"])
      ?? firstNestedNumericLikeValue(record, ["quota", "credits", "balance"], ["remaining", "remain", "available"]);
    const unit = firstStringValue(record, ["unit", "currency"]) ?? firstNestedStringValue(record, ["quota", "balance"], ["unit", "currency"]);
    if (remaining !== undefined) return formatBalanceValue(remaining, unit);
    const balance = firstNumericLikeValue(record, ["balance", "credit", "credits", "amount"]);
    if (balance !== undefined) return formatBalanceValue(balance, unit);
    return summarizeBalanceObject(record) ?? JSON.stringify(record).slice(0, 120);
  }
  if (typeof result === "string") return result.trim().slice(0, 120) || "ok";
  if (typeof result === "number" || typeof result === "boolean") return String(result);
  return "ok";
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

export function extractModelIds(parsed: unknown): string[] {
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

function firstStringValue(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function tryParseJson(value: string): unknown | undefined {
  const trimmed = value.trim();
  if (!trimmed || !["{", "["].includes(trimmed[0] ?? "")) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function normalizeModelConfig(value: unknown): ModelsJsonModelConfig[] {
  if (!value || typeof value !== "object") return [];
  const model = value as Record<string, unknown>;
  const id = typeof model.id === "string" ? model.id.trim() : "";
  if (!id) return [];
  const compat = normalizeCompat(model.compat);
  return [{
    id,
    ...(typeof model.name === "string" ? { name: model.name } : {}),
    ...(typeof model.api === "string" ? { api: model.api } : {}),
    ...(typeof model.enabled === "boolean" ? { enabled: model.enabled } : {}),
    ...(typeof model.reasoning === "boolean" ? { reasoning: model.reasoning } : {}),
    ...(Array.isArray(model.input) ? { input: model.input.filter((entry): entry is string => typeof entry === "string") } : {}),
    ...(typeof model.contextWindow === "number" ? { contextWindow: model.contextWindow } : {}),
    ...(typeof model.maxTokens === "number" ? { maxTokens: model.maxTokens } : {}),
    ...(compat ? { compat } : {}),
  }];
}

function normalizeCompat(value: unknown): ModelsJsonCompat | undefined {
  if (!value || typeof value !== "object") return undefined;
  const compat = value as Record<string, unknown>;
  const openaiProviderTools = normalizeOpenAiProviderToolsCompat(compat.openaiProviderTools);
  const normalized: ModelsJsonCompat = {
    ...(typeof compat.supportsDeveloperRole === "boolean" ? { supportsDeveloperRole: compat.supportsDeveloperRole } : {}),
    ...(typeof compat.supportsReasoningEffort === "boolean" ? { supportsReasoningEffort: compat.supportsReasoningEffort } : {}),
    ...(openaiProviderTools ? { openaiProviderTools } : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeOpenAiProviderToolsCompat(value: unknown): ModelsJsonOpenAiProviderToolsCompat | undefined {
  if (!value || typeof value !== "object") return undefined;
  const compat = value as Record<string, unknown>;
  const normalized: ModelsJsonOpenAiProviderToolsCompat = {
    ...(typeof compat.enabled === "boolean" ? { enabled: compat.enabled } : {}),
    ...(typeof compat.imageGeneration === "boolean" ? { imageGeneration: compat.imageGeneration } : {}),
    ...(typeof compat.outputDirectory === "string" ? { outputDirectory: compat.outputDirectory } : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
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

export function stripJsonCommentsAndTrailingCommas(input: string): string {
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
  const parsed = tryParseJson(trimmed);
  if (parsed && typeof parsed === "object") {
    const summary = summarizeBalanceObject(parsed as Record<string, unknown>);
    if (summary) return summary;
  }
  return trimmed.slice(0, 120);
}

function summarizeBalanceObject(value: Record<string, unknown>): string | undefined {
  const validity = typeof value.isValid === "boolean" ? (value.isValid ? "valid" : "invalid") : undefined;
  const mode = firstStringValue(value, ["mode", "plan", "tier", "status"]);
  if (mode && ["unrestricted", "unlimited"].includes(mode.toLowerCase())) {
    return [validity, mode].filter(Boolean).join(" · ");
  }
  const remaining = firstNumericLikeValue(value, ["remaining", "remain", "available", "available_balance", "availableBalance"])
    ?? firstNestedNumericLikeValue(value, ["quota", "credits", "balance"], ["remaining", "remain", "available"]);
  const balance = firstNumericLikeValue(value, ["balance", "credit", "credits", "amount"]);
  const used = firstNumericLikeValue(value, ["used", "usage", "spent"])
    ?? firstNestedNumericLikeValue(value, ["quota"], ["used", "usage", "spent"]);
  const total = firstNumericLikeValue(value, ["total", "limit", "quota"])
    ?? firstNestedNumericLikeValue(value, ["quota"], ["total", "limit"]);
  const unit = firstStringValue(value, ["unit", "currency"]) ?? firstNestedStringValue(value, ["quota", "balance"], ["unit", "currency"]);
  const parts = [
    validity,
    remaining !== undefined ? `remaining ${formatBalanceValue(remaining, unit)}` : undefined,
    balance !== undefined ? `balance ${formatBalanceValue(balance, unit)}` : undefined,
    used !== undefined ? `used ${formatBalanceValue(used, unit)}` : undefined,
    total !== undefined ? `total ${formatBalanceValue(total, unit)}` : undefined,
    mode,
  ].filter((part): part is string => Boolean(part));
  if (parts.length > 0) return [...new Set(parts)].join(" · ");
  const modelStats = Array.isArray(value.model_stats) ? value.model_stats : Array.isArray(value.modelStats) ? value.modelStats : undefined;
  if (modelStats) return [validity, mode, `${modelStats.length} model usage records`].filter(Boolean).join(" · ");
  return undefined;
}

function firstNumericLikeValue(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function firstNestedNumericLikeValue(record: Record<string, unknown>, parents: readonly string[], keys: readonly string[]): string | undefined {
  for (const parent of parents) {
    const value = record[parent];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const found = firstNumericLikeValue(value as Record<string, unknown>, keys);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function firstNestedStringValue(record: Record<string, unknown>, parents: readonly string[], keys: readonly string[]): string | undefined {
  for (const parent of parents) {
    const value = record[parent];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const found = firstStringValue(value as Record<string, unknown>, keys);
      if (found) return found;
    }
  }
  return undefined;
}

function formatBalanceValue(value: string, unit: string | undefined): string {
  const numeric = Number(value.replace(/,/g, ""));
  const displayValue = Number.isFinite(numeric) ? numeric.toFixed(1) : value;
  return unit ? `${displayValue} ${unit}` : displayValue;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "ENOENT");
}
