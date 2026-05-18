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
