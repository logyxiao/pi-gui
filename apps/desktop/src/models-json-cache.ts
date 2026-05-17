import type { ModelsJsonFile, ModelsJsonSaveResult } from "./models-json";

let cached: Promise<ModelsJsonFile> | undefined;

function ensurePiApp(): NonNullable<typeof window.piApp> {
  if (!window.piApp) {
    throw new Error("Desktop API unavailable");
  }
  return window.piApp;
}

export function readModelsJsonCached(): Promise<ModelsJsonFile> {
  if (!cached) {
    cached = ensurePiApp().readModelsJson();
    cached.catch(() => {
      cached = undefined;
    });
  }
  return cached;
}

export async function writeModelsJsonInvalidating(modelsJson: ModelsJsonFile): Promise<ModelsJsonSaveResult> {
  cached = undefined;
  const result = await ensurePiApp().writeModelsJson(modelsJson);
  cached = Promise.resolve(modelsJson);
  return result;
}

export function invalidateModelsJsonCache(): void {
  cached = undefined;
}
