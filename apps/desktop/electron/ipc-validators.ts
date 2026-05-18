import type { ModelsJsonFile, ProviderEndpointProbeInput } from "./models-json-service";
import type { HostUiResponse } from "@pi-gui/session-driver";
import type { NotificationPreferences } from "../src/desktop-state";

const MAX_STRING = 64 * 1024;
const MAX_COMMIT_MESSAGE = 16 * 1024;
const MAX_PROVIDER_ID = 256;
const MAX_API_KEY = 4 * 1024;
const MAX_HEADER_VALUE = 4 * 1024;
const MAX_USAGE_SCRIPT = 64 * 1024;
const MAX_PROVIDERS = 200;
const MAX_MODELS_PER_PROVIDER = 200;

function fail(field: string, reason: string): never {
  throw new Error(`Invalid IPC payload: ${field} ${reason}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertNonEmptyString(value: unknown, field: string, max = MAX_STRING): string {
  if (typeof value !== "string") fail(field, "must be a string");
  if (value.length === 0) fail(field, "must not be empty");
  if (value.length > max) fail(field, `must be ≤ ${max} chars`);
  return value;
}

export function assertString(value: unknown, field: string, max = MAX_STRING): string {
  if (typeof value !== "string") fail(field, "must be a string");
  if (value.length > max) fail(field, `must be ≤ ${max} chars`);
  return value;
}

export function assertCommitMessage(value: unknown): string {
  return assertNonEmptyString(value, "commitStagedChanges.message", MAX_COMMIT_MESSAGE);
}

export function assertWorkspaceId(value: unknown, field = "workspaceId"): string {
  return assertNonEmptyString(value, field, 1024);
}

export function assertProviderId(value: unknown, field = "providerId"): string {
  return assertNonEmptyString(value, field, MAX_PROVIDER_ID);
}

export function assertApiKey(value: unknown, field = "apiKey"): string {
  return assertString(value, field, MAX_API_KEY);
}

function assertHeaders(value: unknown, field: string): Record<string, string> {
  if (value == null) return {};
  if (!isPlainObject(value)) fail(field, "must be an object");
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof key !== "string" || key.length === 0 || key.length > 256) {
      fail(`${field}.${key}`, "header name invalid");
    }
    if (typeof raw !== "string") fail(`${field}.${key}`, "must be a string");
    if (raw.length > MAX_HEADER_VALUE) fail(`${field}.${key}`, `must be ≤ ${MAX_HEADER_VALUE} chars`);
    result[key] = raw;
  }
  return result;
}

function assertModelEntry(value: unknown, field: string): Record<string, unknown> {
  if (!isPlainObject(value)) fail(field, "must be an object");
  if (value.id !== undefined) assertString(value.id, `${field}.id`, 512);
  if (value.name !== undefined) assertString(value.name, `${field}.name`, 512);
  if (value.api !== undefined) assertString(value.api, `${field}.api`, 256);
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    fail(`${field}.enabled`, "must be a boolean");
  }
  if (value.reasoning !== undefined && typeof value.reasoning !== "boolean") {
    fail(`${field}.reasoning`, "must be a boolean");
  }
  if (value.compat !== undefined) assertCompat(value.compat, `${field}.compat`);
  return value;
}

function assertCompat(value: unknown, field: string): Record<string, unknown> {
  if (!isPlainObject(value)) fail(field, "must be an object");
  if (value.supportsDeveloperRole !== undefined && typeof value.supportsDeveloperRole !== "boolean") {
    fail(`${field}.supportsDeveloperRole`, "must be a boolean");
  }
  if (value.supportsReasoningEffort !== undefined && typeof value.supportsReasoningEffort !== "boolean") {
    fail(`${field}.supportsReasoningEffort`, "must be a boolean");
  }
  if (value.openaiProviderTools !== undefined) {
    assertOpenAiProviderToolsCompat(value.openaiProviderTools, `${field}.openaiProviderTools`);
  }
  return value;
}

function assertOpenAiProviderToolsCompat(value: unknown, field: string): Record<string, unknown> {
  if (!isPlainObject(value)) fail(field, "must be an object");
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    fail(`${field}.enabled`, "must be a boolean");
  }
  if (value.imageGeneration !== undefined && typeof value.imageGeneration !== "boolean") {
    fail(`${field}.imageGeneration`, "must be a boolean");
  }
  if (value.outputDirectory !== undefined) {
    assertString(value.outputDirectory, `${field}.outputDirectory`, 4 * 1024);
  }
  return value;
}

function assertProviderConfig(value: unknown, field: string): Record<string, unknown> {
  if (!isPlainObject(value)) fail(field, "must be an object");
  if (value.baseUrl !== undefined) assertString(value.baseUrl, `${field}.baseUrl`, 4 * 1024);
  if (value.api !== undefined) assertString(value.api, `${field}.api`, 256);
  if (value.apiKey !== undefined) assertString(value.apiKey, `${field}.apiKey`, MAX_API_KEY);
  if (value.balanceBaseUrl !== undefined) assertString(value.balanceBaseUrl, `${field}.balanceBaseUrl`, 4 * 1024);
  if (value.balanceApiKey !== undefined) assertString(value.balanceApiKey, `${field}.balanceApiKey`, MAX_API_KEY);
  if (value.usageScript !== undefined) assertString(value.usageScript, `${field}.usageScript`, MAX_USAGE_SCRIPT);
  if (value.usageLastValue !== undefined) assertString(value.usageLastValue, `${field}.usageLastValue`, 1024);
  if (value.usageLastCheckedAt !== undefined) assertString(value.usageLastCheckedAt, `${field}.usageLastCheckedAt`, 128);
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    fail(`${field}.enabled`, "must be a boolean");
  }
  if (value.authHeader !== undefined && typeof value.authHeader !== "boolean") {
    fail(`${field}.authHeader`, "must be a boolean");
  }
  if (value.compat !== undefined) assertCompat(value.compat, `${field}.compat`);
  if (value.headers !== undefined) assertHeaders(value.headers, `${field}.headers`);
  if (value.models !== undefined) {
    if (!Array.isArray(value.models)) fail(`${field}.models`, "must be an array");
    if (value.models.length > MAX_MODELS_PER_PROVIDER) {
      fail(`${field}.models`, `must have ≤ ${MAX_MODELS_PER_PROVIDER} entries`);
    }
    value.models.forEach((entry, index) => assertModelEntry(entry, `${field}.models[${index}]`));
  }
  return value;
}

export function assertModelsJson(value: unknown, field = "modelsJson"): ModelsJsonFile {
  if (!isPlainObject(value)) fail(field, "must be an object");
  const providers = value.providers;
  if (!isPlainObject(providers)) fail(`${field}.providers`, "must be an object");
  const ids = Object.keys(providers);
  if (ids.length > MAX_PROVIDERS) fail(`${field}.providers`, `must have ≤ ${MAX_PROVIDERS} entries`);
  for (const id of ids) {
    if (id.length === 0 || id.length > MAX_PROVIDER_ID) {
      fail(`${field}.providers["${id}"]`, "id length invalid");
    }
    assertProviderConfig(providers[id], `${field}.providers["${id}"]`);
  }
  return value as unknown as ModelsJsonFile;
}

export function assertProviderInput(value: unknown, field = "provider"): ProviderEndpointProbeInput & {
  readonly balanceBaseUrl?: string;
  readonly balanceApiKey?: string;
  readonly usageScript?: string;
} {
  const validated = assertProviderConfig(value, field);
  if (typeof validated.baseUrl !== "string" || validated.baseUrl.length === 0) {
    fail(`${field}.baseUrl`, "must be a non-empty string");
  }
  return validated as unknown as ProviderEndpointProbeInput & {
    readonly balanceBaseUrl?: string;
    readonly balanceApiKey?: string;
    readonly usageScript?: string;
  };
}

export function assertHostUiResponse(value: unknown): HostUiResponse {
  if (!isPlainObject(value)) fail("respondToHostUiRequest.response", "must be an object");
  assertNonEmptyString(value.requestId, "respondToHostUiRequest.requestId", 1024);
  return value as unknown as HostUiResponse;
}

export function assertNotificationPreferences(value: unknown): Partial<NotificationPreferences> {
  if (!isPlainObject(value)) fail("notificationPreferences", "must be an object");
  for (const key of ["backgroundCompletion", "backgroundFailure", "attentionNeeded"]) {
    if (key in value && typeof value[key] !== "boolean") {
      fail(`notificationPreferences.${key}`, "must be a boolean");
    }
  }
  return value as unknown as Partial<NotificationPreferences>;
}
