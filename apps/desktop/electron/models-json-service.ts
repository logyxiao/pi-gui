import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

export interface CcSwitchSyncResult extends ModelsJsonSaveResult {
  readonly sourcePath: string;
  readonly importedProviderCount: number;
  readonly importedModelCount: number;
  readonly syncedPatternCount: number;
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
  settings.enabledModels = patterns;
  await mkdir(join(getAgentDir()), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return patterns;
}

export async function syncCcSwitchProviders(): Promise<CcSwitchSyncResult> {
  const candidates = getCcSwitchDatabaseCandidates();
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`cc-switch database not found. Checked: ${candidates.join(", ")}`);
  }
  const extracted = await extractCcSwitchProviders(found);
  const importedProviderCount = Object.keys(extracted.providers).length;
  const importedModelCount = Object.values(extracted.providers).reduce((count, provider) => count + (provider.models?.length ?? 0), 0);
  if (importedProviderCount === 0) {
    throw new Error(`No cc-switch provider records found in ${found}`);
  }
  const current = await readModelsJson();
  const merged = mergeModelsJson(current, extracted);
  const saveResult = await writeModelsJson(merged);
  const patterns = await syncEnabledModelsToSettings(merged);
  return {
    ...saveResult,
    sourcePath: found,
    importedProviderCount,
    importedModelCount,
    syncedPatternCount: patterns.length,
  };
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

function getCcSwitchDatabaseCandidates(): string[] {
  const localAppData = process.env.LOCALAPPDATA;
  const appData = process.env.APPDATA;
  const candidates = [
    process.env.CC_SWITCH_DB_PATH,
    localAppData ? join(localAppData, "com.ccswitch.desktop", "cc-switch.db") : undefined,
    localAppData ? join(localAppData, "com.ccswitch.desktop", "ccswitch.db") : undefined,
    localAppData ? join(localAppData, "com.ccswitch.desktop", "database.sqlite") : undefined,
    localAppData ? join(localAppData, "com.ccswitch.desktop", "app.db") : undefined,
    appData ? join(appData, "cc-switch", "cc-switch.db") : undefined,
    appData ? join(appData, "ccswitch", "ccswitch.db") : undefined,
    join(homedir(), ".cc-switch", "cc-switch.db"),
    join(homedir(), ".ccswitch", "ccswitch.db"),
  ];
  return candidates.filter((candidate): candidate is string => Boolean(candidate));
}

async function extractCcSwitchProviders(databasePath: string): Promise<ModelsJsonFile> {
  const rows = await queryCcSwitchProviderRows(databasePath);
  const providers: Record<string, ModelsJsonProviderConfig> = {};
  for (const row of rows) {
    const provider = providerFromCcSwitchRow(row);
    if (!provider) continue;
    providers[provider.id] = mergeProvider(providers[provider.id], provider.config);
  }
  return { providers };
}

async function queryCcSwitchProviderRows(databasePath: string): Promise<unknown[]> {
  const tempDir = await mkdtemp(join(tmpdir(), "pi-ccswitch-"));
  const scriptPath = join(tempDir, "extract-providers.py");
  const outputPath = join(tempDir, "providers.json");
  const script = `
import json, sqlite3, sys
path, out = sys.argv[1], sys.argv[2]
conn = sqlite3.connect(path)
conn.row_factory = sqlite3.Row
exists = conn.execute("select 1 from sqlite_master where type='table' and name='providers'").fetchone()
rows = []
if exists:
    for row in conn.execute("select * from providers").fetchall():
        rows.append({key: row[key] for key in row.keys()})
with open(out, 'w', encoding='utf-8') as f:
    json.dump(rows, f, ensure_ascii=False)
`;
  await writeFile(scriptPath, script, "utf8");
  try {
    await execFileAsync(resolvePythonCommand(), [scriptPath, databasePath, outputPath], { timeout: 15_000, maxBuffer: 1024 * 1024 * 20 });
    return JSON.parse(await readFile(outputPath, "utf8")) as unknown[];
  } catch (error) {
    throw wrapPythonError(error);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function querySqliteJsonRows(databasePath: string): Promise<unknown[]> {
  const tempDir = await mkdtemp(join(tmpdir(), "pi-ccswitch-"));
  const scriptPath = join(tempDir, "extract.py");
  const outputPath = join(tempDir, "rows.json");
  const script = `
import json, sqlite3, sys
path, out = sys.argv[1], sys.argv[2]
conn = sqlite3.connect(path)
conn.row_factory = sqlite3.Row
rows = []
for table in conn.execute("select name from sqlite_master where type='table'").fetchall():
    name = table[0]
    if name.startswith('sqlite_'):
        continue
    columns = [c[1] for c in conn.execute('pragma table_info("%s")' % name.replace('"', '""')).fetchall()]
    if not columns:
        continue
    try:
        for row in conn.execute('select * from "%s"' % name.replace('"', '""')).fetchall():
            item = {column: row[column] for column in columns}
            item['__table'] = name
            rows.append(item)
    except Exception:
        pass
with open(out, 'w', encoding='utf-8') as f:
    json.dump(rows, f, ensure_ascii=False)
`;
  await writeFile(scriptPath, script, "utf8");
  try {
    await execFileAsync(resolvePythonCommand(), [scriptPath, databasePath, outputPath], { timeout: 15_000, maxBuffer: 1024 * 1024 * 20 });
    return JSON.parse(await readFile(outputPath, "utf8")) as unknown[];
  } catch (error) {
    throw wrapPythonError(error);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function resolvePythonCommand(): string {
  return process.platform === "win32" ? "python" : "python3";
}

function wrapPythonError(error: unknown): Error {
  if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT") {
    const cmd = resolvePythonCommand();
    return new Error(`cc-switch sync requires ${cmd} on PATH but it was not found. Install Python 3 or configure PATH for the Electron process.`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function providerFromCcSwitchRow(input: unknown): { readonly id: string; readonly config: ModelsJsonProviderConfig } | undefined {
  if (!input || typeof input !== "object") return undefined;
  const row = input as Record<string, unknown>;
  const settings = tryParseJson(typeof row.settings_config === "string" ? row.settings_config : "") as Record<string, unknown> | undefined;
  if (!settings || typeof settings !== "object") return undefined;
  const meta = tryParseJson(typeof row.meta === "string" ? row.meta : "") as Record<string, unknown> | undefined;
  const appType = typeof row.app_type === "string" ? row.app_type : undefined;
  const category = typeof row.category === "string" ? row.category : undefined;
  const rawId = typeof row.id === "string" ? row.id : "cc-switch";
  const providerName = typeof row.name === "string" && row.name.trim() ? row.name.trim() : rawId;
  const env = settings.env && typeof settings.env === "object" ? settings.env as Record<string, unknown> : {};
  const options = settings.options && typeof settings.options === "object" ? settings.options as Record<string, unknown> : {};
  const auth = settings.auth && typeof settings.auth === "object" ? settings.auth as Record<string, unknown> : {};
  const configText = typeof settings.config === "string" ? settings.config : "";
  const baseUrl = firstStringValue(options, ["baseURL", "baseUrl", "base_url"])
    ?? firstStringValue(env, ["ANTHROPIC_BASE_URL", "OPENAI_BASE_URL", "BASE_URL"])
    ?? extractTomlString(configText, "base_url");
  const apiKey = firstStringValue(options, ["apiKey", "api_key"])
    ?? firstStringValue(auth, ["OPENAI_API_KEY", "apiKey", "api_key"])
    ?? firstStringValue(env, ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);
  const models = extractCcSwitchModelsFromSettings(settings, env, configText);
  const isUsableCustomProvider = Boolean(baseUrl && (apiKey || models.length > 0));
  if (!isUsableCustomProvider) return undefined;
  if (category === "official" && !apiKey && models.length === 0) return undefined;
  if (!baseUrl) return undefined;
  const headers = extractCcSwitchHeaders(settings);
  const usageScript = meta?.usage_script && typeof meta.usage_script === "object" ? meta.usage_script as Record<string, unknown> : undefined;
  const usageScriptCode = typeof usageScript?.code === "string" ? usageScript.code : undefined;
  const balanceBaseUrl = buildCcSwitchBalanceUrl(usageScript, baseUrl);
  const balanceApiKey = firstStringValue(usageScript ?? {}, ["apiKey", "api_key"]) ?? apiKey;
  const id = sanitizeProviderId(`ccswitch-${appType ?? "provider"}-${providerName}`);
  return {
    id,
    config: {
      baseUrl,
      api: inferCcSwitchApiType(appType, meta, configText),
      ...(apiKey ? { apiKey } : {}),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(balanceBaseUrl ? { balanceBaseUrl } : {}),
      ...(balanceApiKey && balanceBaseUrl ? { balanceApiKey } : {}),
      ...(usageScriptCode ? { usageScript: usageScriptCode } : {}),
      enabled: true,
      models,
    },
  };
}

function flattenRecords(input: unknown): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  const visit = (value: unknown, prefix = "") => {
    if (typeof value === "string") {
      const parsed = tryParseJson(value);
      if (parsed !== undefined) {
        visit(parsed, prefix);
        return;
      }
    }
    if (!value || typeof value !== "object") return;
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      output[path] = raw;
      output[key] ??= raw;
      if (raw && typeof raw === "object") visit(raw, path);
      else if (typeof raw === "string") {
        const parsed = tryParseJson(raw);
        if (parsed !== undefined) visit(parsed, path);
      }
    }
  };
  visit(input);
  return output;
}

function extractCcSwitchModelsFromSettings(settings: Record<string, unknown>, env: Record<string, unknown>, configText: string): ModelsJsonModelConfig[] {
  const models: ModelsJsonModelConfig[] = [];
  const add = (id: string | undefined, name?: string) => {
    const trimmed = id?.trim();
    if (!trimmed || models.some((model) => model.id === trimmed)) return;
    models.push({ id: trimmed, ...(name ? { name } : {}), enabled: true });
  };
  const rawModels = settings.models;
  if (rawModels && typeof rawModels === "object") {
    for (const [modelId, rawModel] of Object.entries(rawModels as Record<string, unknown>)) {
      const name = rawModel && typeof rawModel === "object" && typeof (rawModel as Record<string, unknown>).name === "string"
        ? (rawModel as Record<string, unknown>).name as string
        : undefined;
      add(modelId, name);
    }
  }
  add(firstStringValue(env, ["ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL"]));
  add(extractTomlString(configText, "model"));
  return models;
}

function firstStringValue(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function firstValueByKeyFragment(record: Record<string, unknown>, fragments: readonly string[]): unknown {
  const normalized = fragments.map((fragment) => fragment.toLowerCase());
  for (const [key, value] of Object.entries(record)) {
    const lower = key.toLowerCase();
    if (normalized.some((fragment) => lower.endsWith(fragment.toLowerCase()) || lower.includes(fragment.toLowerCase()))) return value;
  }
  return undefined;
}

function extractHeaders(record: Record<string, unknown>): Record<string, string> {
  const headers = firstValueByKeyFragment(record, ["headers", "header"]);
  return headers && typeof headers === "object" && !Array.isArray(headers) ? normalizeStringRecord(headers) : {};
}

function extractCcSwitchHeaders(settings: Record<string, unknown>): Record<string, string> {
  const headers = settings.headers ?? (settings.options && typeof settings.options === "object" ? (settings.options as Record<string, unknown>).headers : undefined);
  return headers && typeof headers === "object" && !Array.isArray(headers) ? normalizeStringRecord(headers) : {};
}

function buildCcSwitchBalanceUrl(usageScript: Record<string, unknown> | undefined, baseUrl: string): string | undefined {
  if (!usageScript || usageScript.enabled === false) return undefined;
  const direct = firstStringValue(usageScript, ["url", "balanceUrl", "balance_url"]);
  if (direct) return interpolateCcSwitchTemplate(direct, usageScript, baseUrl);
  const code = typeof usageScript.code === "string" ? usageScript.code : "";
  const match = /url\s*:\s*["'`]([^"'`]+)["'`]/.exec(code);
  return match?.[1] ? interpolateCcSwitchTemplate(match[1], usageScript, baseUrl) : undefined;
}

function interpolateCcSwitchTemplate(template: string, usageScript: Record<string, unknown>, baseUrl: string): string {
  const scriptBaseUrl = firstStringValue(usageScript, ["baseUrl", "base_url"]) ?? baseUrl;
  return template
    .replaceAll("{{baseUrl}}", scriptBaseUrl.replace(/\/+$/, ""))
    .replaceAll("{{apiKey}}", firstStringValue(usageScript, ["apiKey", "api_key"]) ?? "");
}

function extractTomlString(configText: string, key: string): string | undefined {
  if (!configText) return undefined;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*=\\s*[\"']([^\"']+)[\"']`).exec(configText);
  return match?.[1]?.trim();
}

function inferCcSwitchApiType(appType: string | undefined, meta: Record<string, unknown> | undefined, configText: string): string {
  const apiFormat = typeof meta?.apiFormat === "string" ? meta.apiFormat : undefined;
  if (apiFormat) return apiFormat;
  const wireApi = extractTomlString(configText, "wire_api");
  if (wireApi === "responses") return "openai-responses";
  if (appType === "claude") return "anthropic";
  if (appType === "gemini") return "gemini";
  return "openai";
}

function sanitizeProviderId(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "cc-switch";
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

function mergeModelsJson(current: ModelsJsonFile, incoming: ModelsJsonFile): ModelsJsonFile {
  const providers: Record<string, ModelsJsonProviderConfig> = Object.fromEntries(
    Object.entries(current.providers).filter(([providerId]) => !providerId.startsWith("ccswitch-")),
  );
  for (const [providerId, provider] of Object.entries(incoming.providers)) {
    providers[providerId] = mergeProvider(providers[providerId], provider);
  }
  return { providers };
}

function mergeProvider(existing: ModelsJsonProviderConfig | undefined, incoming: ModelsJsonProviderConfig): ModelsJsonProviderConfig {
  const modelMap = new Map<string, ModelsJsonModelConfig>();
  for (const model of existing?.models ?? []) modelMap.set(model.id, model);
  for (const model of incoming.models ?? []) modelMap.set(model.id, { ...modelMap.get(model.id), ...model });
  return {
    ...existing,
    ...incoming,
    headers: { ...(existing?.headers ?? {}), ...(incoming.headers ?? {}) },
    models: Array.from(modelMap.values()).filter((model) => model.id),
  };
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
