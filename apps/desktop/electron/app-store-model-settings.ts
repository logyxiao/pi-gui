import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ModelSettingsSnapshot,
  RuntimeSettingsSnapshot,
  RuntimeSnapshot,
} from "@pi-gui/session-driver/runtime-types";

export function applyModelSettingsSnapshot(
  runtime: RuntimeSnapshot,
  settings: ModelSettingsSnapshot,
): RuntimeSnapshot {
  return {
    ...runtime,
    settings: {
      ...runtime.settings,
      ...(settings.defaultProvider ? { defaultProvider: settings.defaultProvider } : { defaultProvider: undefined }),
      ...(settings.defaultModelId ? { defaultModelId: settings.defaultModelId } : { defaultModelId: undefined }),
      ...(settings.defaultThinkingLevel
        ? { defaultThinkingLevel: settings.defaultThinkingLevel }
        : { defaultThinkingLevel: undefined }),
      enabledModelPatterns: [...settings.enabledModelPatterns],
    },
  };
}

export async function readProjectModelSettingsFile(workspacePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(join(workspacePath, ".pi", "settings.json"), "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function updateProjectModelSettingsFile(
  workspacePath: string,
  updater: (settings: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const current = await readProjectModelSettingsFile(workspacePath);
  const next = updater({ ...current });
  const configDir = join(workspacePath, ".pi");
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, "settings.json"), `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

export function mergeModelSettingsSnapshot(
  globalSettings: ModelSettingsSnapshot,
  projectSettings: Record<string, unknown>,
): ModelSettingsSnapshot {
  const defaultProvider =
    typeof projectSettings.defaultProvider === "string"
      ? projectSettings.defaultProvider
      : globalSettings.defaultProvider;
  const defaultModelId =
    typeof projectSettings.defaultModel === "string"
      ? projectSettings.defaultModel
      : globalSettings.defaultModelId;
  const defaultThinkingLevel =
    typeof projectSettings.defaultThinkingLevel === "string"
      ? (projectSettings.defaultThinkingLevel as RuntimeSettingsSnapshot["defaultThinkingLevel"])
      : globalSettings.defaultThinkingLevel;

  return {
    enabledModelPatterns: Array.isArray(projectSettings.enabledModels)
      ? projectSettings.enabledModels.filter((value): value is string => typeof value === "string")
      : [...globalSettings.enabledModelPatterns],
    ...(defaultProvider ? { defaultProvider } : {}),
    ...(defaultModelId ? { defaultModelId } : {}),
    ...(defaultThinkingLevel ? { defaultThinkingLevel } : {}),
  };
}

export function hasStoredModelSettings(settings: ModelSettingsSnapshot | undefined): settings is ModelSettingsSnapshot {
  return Boolean(
    settings &&
      (settings.enabledModelPatterns.length > 0 ||
        settings.defaultProvider ||
        settings.defaultModelId ||
        settings.defaultThinkingLevel),
  );
}

export function modelSettingsEqual(left: ModelSettingsSnapshot, right: ModelSettingsSnapshot): boolean {
  return (
    left.defaultProvider === right.defaultProvider &&
    left.defaultModelId === right.defaultModelId &&
    left.defaultThinkingLevel === right.defaultThinkingLevel &&
    left.enabledModelPatterns.length === right.enabledModelPatterns.length &&
    left.enabledModelPatterns.every((pattern, index) => pattern === right.enabledModelPatterns[index])
  );
}

export function mergeEnabledModelPatterns(
  existingPatterns: readonly string[],
  providerPatterns: readonly string[],
): readonly string[] {
  const merged = [...existingPatterns];
  const seen = new Set(existingPatterns);
  for (const pattern of providerPatterns) {
    if (seen.has(pattern)) {
      continue;
    }
    seen.add(pattern);
    merged.push(pattern);
  }
  return merged;
}
