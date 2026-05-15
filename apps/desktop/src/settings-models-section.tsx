import { useEffect, useMemo, useState } from "react";
import type { RuntimeSettingsSnapshot, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ModelsJsonFile, ModelsJsonModelConfig, ModelsJsonProviderConfig, ProviderProbeResult } from "./models-json";
import {
  labelForThinking,
  settingsPill,
  SettingsGroup,
  SettingsRow,
  THINKING_LEVELS,
} from "./settings-utils";
import { useI18n, type I18nContextValue } from "./i18n";
import { SearchableSelect } from "./searchable-select";

interface SettingsModelsSectionProps {
  readonly runtime?: RuntimeSnapshot;
  readonly onSetDefaultModel: (provider: string, modelId: string) => void;
  readonly onSetThinkingLevel: (thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"]) => void;
  readonly onRefreshRuntime?: () => void;
}

export function SettingsModelsSection({
  runtime,
  onSetDefaultModel,
  onSetThinkingLevel,
  onRefreshRuntime,
}: SettingsModelsSectionProps) {
  const { t } = useI18n();

  const availableModels = (runtime?.models ?? []).filter((m) => m.available);
  const enabledPatterns = runtime?.settings.enabledModelPatterns ?? [];
  const allImplicitlyEnabled = enabledPatterns.length === 0;
  const enabledModelSet = new Set(enabledPatterns);
  const enabledAvailableModels = availableModels.filter((model) =>
    allImplicitlyEnabled || enabledModelSet.has(`${model.providerId}/${model.modelId}`),
  );

  const defaultProvider = runtime?.settings.defaultProvider;
  const defaultModelId = runtime?.settings.defaultModelId;
  const defaultIsEnabled =
    defaultProvider && defaultModelId
      ? enabledAvailableModels.some((m) => m.providerId === defaultProvider && m.modelId === defaultModelId)
      : false;

  return (
    <>
      <SettingsGroup>
        <SettingsRow title={t("settings.models.defaultModel")} description={t("settings.models.defaultModelDescription")}>
          <SearchableSelect
            value={
              defaultProvider && defaultModelId && defaultIsEnabled
                ? `${defaultProvider}:${defaultModelId}`
                : ""
            }
            placeholder={t("settings.models.chooseModel")}
            searchPlaceholder={t("settings.models.searchModels")}
            options={enabledAvailableModels.map((model) => ({
              value: `${model.providerId}:${model.modelId}`,
              label: `${model.providerName} · ${model.label}`,
              meta: `${model.providerId}:${model.modelId}`,
            }))}
            onChange={(value) => {
              const [provider, ...modelParts] = value.split(":");
              const modelId = modelParts.join(":");
              if (provider && modelId) {
                onSetDefaultModel(provider, modelId);
              }
            }}
          />
        </SettingsRow>
        <SettingsRow title={t("settings.models.reasoning")} description={t("settings.models.reasoningDescription")}>
          <div className="settings-pill-row">
            {THINKING_LEVELS.map((level) => (
              <button
                className={settingsPill(runtime?.settings.defaultThinkingLevel === level)}
                key={level}
                type="button"
                onClick={() => onSetThinkingLevel(level)}
              >
                {labelForThinking(level, t)}
              </button>
            ))}
          </div>
        </SettingsRow>
      </SettingsGroup>

      <AdvancedModelsManager onRefreshRuntime={onRefreshRuntime} />

      {!defaultIsEnabled && defaultProvider && defaultModelId ? (
        <SettingsGroup>
          <div className="settings-row">
            <span className="settings-warning">
              {t("settings.models.defaultNotEnabled", { provider: defaultProvider, model: defaultModelId })}
            </span>
          </div>
        </SettingsGroup>
      ) : null}
    </>
  );
}

function AdvancedModelsManager({ onRefreshRuntime }: { readonly onRefreshRuntime?: () => void }) {
  const { t } = useI18n();
  const [modelsJson, setModelsJson] = useState<ModelsJsonFile>({ providers: {} });
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<StatusMessage | undefined>();
  const [renameValue, setRenameValue] = useState("");
  const [newProviderId, setNewProviderId] = useState("");
  const [newModelId, setNewModelId] = useState("");
  const [providerQuery, setProviderQuery] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [headersText, setHeadersText] = useState("{}");
  const providerIds = useMemo(() => Object.keys(modelsJson.providers).sort((a, b) => a.localeCompare(b)), [modelsJson]);
  const filteredProviderIds = useMemo(() => {
    const query = providerQuery.trim().toLowerCase();
    if (!query) return providerIds;
    return providerIds.filter((providerId) => providerId.toLowerCase().includes(query));
  }, [providerIds, providerQuery]);
  const selectedProvider = selectedProviderId ? modelsJson.providers[selectedProviderId] : undefined;
  const selectedModels = selectedProvider?.models ?? [];
  const filteredSelectedModels = useMemo(() => {
    const query = modelQuery.trim().toLowerCase();
    if (!query) return selectedModels;
    return selectedModels.filter((model) => [model.id, model.name ?? ""].some((value) => value.toLowerCase().includes(query)));
  }, [modelQuery, selectedModels]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!window.piApp) {
        setStatus({ kind: "error", text: t("settings.models.desktopApiUnavailable") });
        setLoading(false);
        return;
      }
      try {
        const file = await window.piApp.readModelsJson();
        if (cancelled) return;
        const ids = Object.keys(file.providers).sort((a, b) => a.localeCompare(b));
        setModelsJson(file);
        setSelectedProviderId((current) => current || ids[0] || "");
        setStatus({ kind: "ok", text: t("settings.models.loadedProviders", { count: ids.length }) });
      } catch (error) {
        if (!cancelled) setStatus({ kind: "error", text: describeError(error, t) });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setRenameValue(selectedProviderId);
    setHeadersText(JSON.stringify(selectedProvider?.headers ?? {}, null, 2));
  }, [selectedProvider?.headers, selectedProviderId]);

  const setProvider = (providerId: string, updater: (provider: ModelsJsonProviderConfig) => ModelsJsonProviderConfig) => {
    setModelsJson((current) => ({
      providers: {
        ...current.providers,
        [providerId]: updater(current.providers[providerId] ?? { enabled: true, models: [] }),
      },
    }));
  };

  const addProvider = () => {
    const id = newProviderId.trim();
    if (!id) return;
    if (modelsJson.providers[id]) {
      setStatus({ kind: "error", text: t("settings.models.providerExists", { id }) });
      return;
    }
    setModelsJson((current) => ({
      providers: {
        ...current.providers,
        [id]: { enabled: true, authHeader: true, models: [] },
      },
    }));
    setSelectedProviderId(id);
    setNewProviderId("");
    setStatus({ kind: "ok", text: t("settings.models.providerAdded", { id }) });
  };

  const renameProvider = () => {
    const nextId = renameValue.trim();
    if (!selectedProviderId || !selectedProvider || !nextId || nextId === selectedProviderId) return;
    if (modelsJson.providers[nextId]) {
      setStatus({ kind: "error", text: t("settings.models.providerExists", { id: nextId }) });
      return;
    }
    const { [selectedProviderId]: _old, ...rest } = modelsJson.providers;
    setModelsJson({ providers: { ...rest, [nextId]: selectedProvider } });
    setSelectedProviderId(nextId);
    setStatus({ kind: "ok", text: t("settings.models.providerRenamed", { id: nextId }) });
  };

  const deleteProvider = () => {
    if (!selectedProviderId) return;
    const { [selectedProviderId]: _removed, ...rest } = modelsJson.providers;
    const ids = Object.keys(rest).sort((a, b) => a.localeCompare(b));
    setModelsJson({ providers: rest });
    setSelectedProviderId(ids[0] ?? "");
    setStatus({ kind: "ok", text: t("settings.models.providerDeleted", { id: selectedProviderId }) });
  };

  const applyProviderHeaders = (): ModelsJsonFile => {
    if (!selectedProviderId) return modelsJson;
    const headers = parseHeaders(headersText, t);
    return {
      providers: {
        ...modelsJson.providers,
        [selectedProviderId]: {
          ...(modelsJson.providers[selectedProviderId] ?? { enabled: true, models: [] }),
          headers,
        },
      },
    };
  };

  const updateProviderHeaders = () => {
    try {
      const nextModelsJson = applyProviderHeaders();
      setModelsJson(nextModelsJson);
      setStatus({ kind: "ok", text: t("settings.models.headersApplied") });
    } catch (error) {
      setStatus({ kind: "error", text: describeError(error, t) });
    }
  };

  const addModel = () => {
    const id = newModelId.trim();
    if (!selectedProviderId || !id) return;
    if (selectedModels.some((model) => model.id === id)) {
      setStatus({ kind: "error", text: t("settings.models.modelExists", { id }) });
      return;
    }
    setProvider(selectedProviderId, (provider) => ({ ...provider, models: [...(provider.models ?? []), { id, enabled: true }] }));
    setNewModelId("");
  };

  const updateModel = (modelId: string, updater: (model: ModelsJsonModelConfig) => ModelsJsonModelConfig) => {
    if (!selectedProviderId) return;
    setProvider(selectedProviderId, (provider) => ({
      ...provider,
      models: (provider.models ?? []).map((model) => (model.id === modelId ? updater(model) : model)),
    }));
  };

  const deleteModel = (modelId: string) => {
    if (!selectedProviderId) return;
    setProvider(selectedProviderId, (provider) => ({
      ...provider,
      models: (provider.models ?? []).filter((model) => model.id !== modelId),
    }));
  };

  const save = async () => {
    if (!window.piApp) return;
    setSaving(true);
    try {
      const nextModelsJson = applyProviderHeaders();
      setModelsJson(nextModelsJson);
      const result = await window.piApp.writeModelsJson(nextModelsJson);
      const patterns = await window.piApp.syncEnabledModels(nextModelsJson);
      onRefreshRuntime?.();
      setStatus({ kind: "ok", text: t("settings.models.saved", { providers: result.providerCount, models: result.modelCount, patterns: patterns.length }) });
    } catch (error) {
      setStatus({ kind: "error", text: describeError(error, t) });
    } finally {
      setSaving(false);
    }
  };

  const runProviderAction = async (action: "test" | "fetch" | "probe") => {
    if (!window.piApp || !selectedProvider || !selectedProviderId) return;
    try {
      const headers = parseHeaders(headersText, t);
      const providerInput = { ...selectedProvider, headers, baseUrl: selectedProvider.baseUrl ?? "" };
      if (!providerInput.baseUrl.trim()) {
        setStatus({ kind: "error", text: t("settings.models.baseUrlRequired") });
        return;
      }
      const result = action === "test"
        ? await window.piApp.testProvider(providerInput)
        : action === "probe"
          ? await window.piApp.probeProvider(providerInput)
          : await window.piApp.fetchProviderModels(providerInput);
      if (action === "fetch" && result.models) {
        mergeFetchedModels(result.models);
      }
      setStatus({ kind: result.status === "ok" ? "ok" : "error", text: formatProbeResult(action, result, t) });
    } catch (error) {
      setStatus({ kind: "error", text: describeError(error, t) });
    }
  };

  const mergeFetchedModels = (modelIds: readonly string[]) => {
    if (!selectedProviderId) return;
    setProvider(selectedProviderId, (provider) => {
      const existing = new Set((provider.models ?? []).map((model) => model.id));
      const additions = modelIds.filter((id) => !existing.has(id)).map((id) => ({ id, enabled: true }));
      return { ...provider, models: [...(provider.models ?? []), ...additions] };
    });
  };

  const importCcSwitchFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const imported = extractProvidersFromImport(JSON.parse(text) as unknown);
      const importedIds = Object.keys(imported.providers);
      if (importedIds.length === 0) {
        setStatus({ kind: "error", text: t("settings.models.noCcSwitchEntries") });
        return;
      }
      setModelsJson((current) => ({ providers: { ...current.providers, ...imported.providers } }));
      setSelectedProviderId(importedIds[0] ?? selectedProviderId);
      setStatus({ kind: "ok", text: t("settings.models.importedCcSwitch", { count: importedIds.length, file: file.name }) });
    } catch (error) {
      setStatus({ kind: "error", text: describeError(error, t) });
    }
  };

  return (
    <SettingsGroup title={t("settings.models.advanced")} description={t("settings.models.advancedDescription")}>
      <div className="model-manager__toolbar">
        <div className="model-manager__add">
          <input className="settings-text-input" placeholder={t("settings.models.providerId")} value={newProviderId} onChange={(event) => setNewProviderId(event.target.value)} />
          <button className="button button--secondary" type="button" onClick={addProvider}>{t("settings.models.addProvider")}</button>
        </div>
        <div className="settings-row__actions">
          <button className="button button--secondary" disabled={loading} type="button" onClick={() => window.piApp?.readModelsJson().then((file) => setModelsJson(file)).catch((error) => setStatus({ kind: "error", text: describeError(error, t) }))}>{t("settings.models.reload")}</button>
          <label className="button button--secondary model-manager__file-button">
            {t("settings.models.importCcSwitch")}
            <input accept="application/json,.json" type="file" onChange={(event) => void importCcSwitchFile(event.target.files?.[0])} />
          </label>
          <button className="button button--primary" disabled={saving} type="button" onClick={() => void save()}>{saving ? t("settings.models.saving") : t("settings.models.saveSync")}</button>
        </div>
      </div>
      {status ? <div className={`model-manager__status model-manager__status--${status.kind}`}>{status.text}</div> : null}
      <div className="model-manager">
        <aside className="model-manager__providers" aria-label={t("settings.nav.providers")}>
          <div className="model-manager__rail-head">
            <div>
              <div className="model-manager__section-label">{t("settings.nav.providers")}</div>
              <strong>{providerIds.length}</strong>
            </div>
          </div>
          <input
            className="settings-search model-manager__filter"
            placeholder={t("settings.providers.search")}
            value={providerQuery}
            onChange={(event) => setProviderQuery(event.target.value)}
          />
          {providerIds.length === 0 ? <div className="settings-hint">{t("settings.models.noProviders")}</div> : null}
          {filteredProviderIds.map((providerId) => {
            const provider = modelsJson.providers[providerId] ?? { models: [] };
            const enabled = provider.enabled !== false;
            return (
              <button className={`model-manager__provider${providerId === selectedProviderId ? " model-manager__provider--active" : ""}`} key={providerId} type="button" onClick={() => setSelectedProviderId(providerId)}>
                <span className="model-manager__provider-name">{providerId}</span>
                <span className="model-manager__provider-meta">{enabled ? t("settings.models.enabled") : "off"} · {provider.models?.length ?? 0}</span>
              </button>
            );
          })}
          {providerIds.length > 0 && filteredProviderIds.length === 0 ? <div className="settings-hint">{t("settings.models.noProviders")}</div> : null}
        </aside>
        {selectedProvider && selectedProviderId ? (
          <div className="model-manager__workspace">
            <section className="model-manager__config" aria-label={t("settings.models.providerId")}>
              <div className="model-manager__panel-head">
                <div>
                  <div className="model-manager__section-label">{t("settings.models.providerId")}</div>
                  <strong>{selectedProviderId}</strong>
                </div>
                <div className="model-manager__toggles">
                  <label className="settings-toggle"><input checked={selectedProvider.enabled !== false} type="checkbox" onChange={(event) => setProvider(selectedProviderId, (provider) => ({ ...provider, enabled: event.target.checked }))} />{t("settings.models.providerEnabled")}</label>
                  <label className="settings-toggle"><input checked={selectedProvider.authHeader !== false} type="checkbox" onChange={(event) => setProvider(selectedProviderId, (provider) => ({ ...provider, authHeader: event.target.checked }))} />{t("settings.models.useBearer")}</label>
                </div>
              </div>
              <div className="model-manager__compact-grid">
                <label className="settings-field">{t("settings.models.providerId")}<input className="settings-text-input" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} /></label>
                <label className="settings-field">{t("settings.models.baseUrl")}<input className="settings-text-input" value={selectedProvider.baseUrl ?? ""} onChange={(event) => setProvider(selectedProviderId, (provider) => ({ ...provider, baseUrl: event.target.value }))} /></label>
                <label className="settings-field">{t("settings.models.apiType")}<input className="settings-text-input" placeholder={t("settings.models.apiTypePlaceholder")} value={selectedProvider.api ?? ""} onChange={(event) => setProvider(selectedProviderId, (provider) => ({ ...provider, api: event.target.value }))} /></label>
                <label className="settings-field">{t("settings.models.apiKey")}<input className="settings-text-input" type="password" value={selectedProvider.apiKey ?? ""} onChange={(event) => setProvider(selectedProviderId, (provider) => ({ ...provider, apiKey: event.target.value }))} /></label>
                <label className="settings-field">{t("settings.models.balanceUrl")}<input className="settings-text-input" value={selectedProvider.balanceBaseUrl ?? ""} onChange={(event) => setProvider(selectedProviderId, (provider) => ({ ...provider, balanceBaseUrl: event.target.value }))} /></label>
                <label className="settings-field">{t("settings.models.balanceKey")}<input className="settings-text-input" type="password" value={selectedProvider.balanceApiKey ?? ""} onChange={(event) => setProvider(selectedProviderId, (provider) => ({ ...provider, balanceApiKey: event.target.value }))} /></label>
              </div>
              <label className="settings-field">{t("settings.models.headersJson")}<textarea className="settings-textarea" value={headersText} onChange={(event) => setHeadersText(event.target.value)} /></label>
              <div className="settings-row__actions model-manager__actions">
                <button className="button button--secondary" type="button" onClick={renameProvider}>{t("settings.models.rename")}</button>
                <button className="button button--secondary" type="button" onClick={updateProviderHeaders}>{t("settings.models.applyHeaders")}</button>
                <button className="button button--secondary" type="button" onClick={() => void runProviderAction("test")}>{t("settings.models.testProvider")}</button>
                <button className="button button--secondary" type="button" onClick={() => void runProviderAction("fetch")}>{t("settings.models.fetchModels")}</button>
                <button className="button button--secondary" type="button" onClick={() => void runProviderAction("probe")}>{t("settings.models.probeBalance")}</button>
                <button className="button button--secondary" type="button" onClick={deleteProvider}>{t("settings.models.deleteProvider")}</button>
              </div>
            </section>
            <section className="model-manager__models-panel" aria-label={t("settings.models.models")}>
              <div className="model-manager__models-head">
                <div>
                  <div className="model-manager__section-label">{t("settings.models.models")}</div>
                  <strong>{filteredSelectedModels.length} / {selectedModels.length}</strong>
                </div>
                <div className="model-manager__add">
                  <input className="settings-search model-manager__filter" placeholder={t("settings.models.searchModels")} value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} />
                  <input className="settings-text-input" placeholder={t("settings.models.modelId")} value={newModelId} onChange={(event) => setNewModelId(event.target.value)} />
                  <button className="button button--secondary" type="button" onClick={addModel}>{t("settings.models.addModel")}</button>
                </div>
              </div>
              <div className="model-manager__models">
                {filteredSelectedModels.map((model) => (
                  <div className="model-manager__model" key={model.id}>
                    <div className="model-manager__model-main">
                      <label className="settings-toggle"><input checked={model.enabled !== false} type="checkbox" onChange={(event) => updateModel(model.id, (current) => ({ ...current, enabled: event.target.checked }))} />{t("settings.models.enabled")}</label>
                      <input className="settings-text-input" value={model.id} onChange={(event) => updateModel(model.id, (current) => ({ ...current, id: event.target.value }))} />
                    </div>
                    <div className="model-manager__model-extra">
                      <input className="settings-text-input" placeholder={t("settings.models.displayName")} value={model.name ?? ""} onChange={(event) => updateModel(model.id, (current) => ({ ...current, name: event.target.value }))} />
                      <label className="settings-toggle"><input checked={model.reasoning === true} type="checkbox" onChange={(event) => updateModel(model.id, (current) => ({ ...current, reasoning: event.target.checked }))} />{t("settings.models.reasoning")}</label>
                      <button className="button button--secondary" type="button" onClick={() => deleteModel(model.id)}>{t("settings.models.delete")}</button>
                    </div>
                  </div>
                ))}
                {selectedModels.length === 0 ? <span className="settings-hint">{t("settings.models.noModels")}</span> : null}
                {selectedModels.length > 0 && filteredSelectedModels.length === 0 ? <span className="settings-hint">{t("settings.models.noModels")}</span> : null}
              </div>
            </section>
          </div>
        ) : <div className="model-manager__empty settings-hint">{t("settings.models.selectProvider")}</div>}
      </div>
    </SettingsGroup>
  );
}

interface StatusMessage {
  readonly kind: "ok" | "error";
  readonly text: string;
}

function parseHeaders(input: string, t?: I18nContextValue["t"]): Record<string, string> {
  const trimmed = input.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(t ? t("settings.models.headersObject") : "Headers must be a JSON object.");
  }
  return normalizeStringRecord(parsed, t);
}

function extractProvidersFromImport(input: unknown): ModelsJsonFile {
  if (!input || typeof input !== "object") return { providers: {} };
  const record = input as Record<string, unknown>;
  const root = record.providers && typeof record.providers === "object" ? record.providers as Record<string, unknown> : record;
  const providers: Record<string, ModelsJsonProviderConfig> = {};
  for (const [providerId, value] of Object.entries(root)) {
    if (!value || typeof value !== "object") continue;
    const provider = value as Record<string, unknown>;
    const baseUrl = firstString(provider.baseUrl, provider.base_url, provider.url, provider.endpoint);
    const models = extractImportedModels(provider.models ?? provider.modelList ?? provider.availableModels);
    if (!baseUrl && models.length === 0) continue;
    providers[providerId] = {
      ...(baseUrl ? { baseUrl } : {}),
      ...(firstString(provider.api, provider.type) ? { api: firstString(provider.api, provider.type) } : {}),
      ...(firstString(provider.apiKey, provider.api_key, provider.key) ? { apiKey: firstString(provider.apiKey, provider.api_key, provider.key) } : {}),
      ...(provider.headers && typeof provider.headers === "object" ? { headers: normalizeStringRecord(provider.headers) } : {}),
      enabled: provider.enabled === false ? false : true,
      models,
    };
  }
  return { providers };
}

function extractImportedModels(input: unknown): ModelsJsonModelConfig[] {
  const values = Array.isArray(input) ? input : input && typeof input === "object" ? Object.values(input as Record<string, unknown>) : [];
  return values.flatMap((value): ModelsJsonModelConfig[] => {
    if (typeof value === "string") return [{ id: value, enabled: true }];
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const id = firstString(record.id, record.name, record.model);
    if (!id) return [];
    return [{ id, name: firstString(record.displayName, record.label), enabled: record.enabled === false ? false : true }];
  });
}

function firstString(...values: readonly unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function normalizeStringRecord(value: unknown, t?: I18nContextValue["t"]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "string") throw new Error(t ? t("settings.models.headerString", { key }) : `Header '${key}' must be a string.`);
    headers[key] = raw;
  }
  return headers;
}

function formatProbeResult(action: string, result: ProviderProbeResult, t: I18nContextValue["t"]): string {
  const actionLabel = action === "fetch" ? t("settings.models.fetchAction") : action === "probe" ? t("settings.models.probeAction") : t("settings.models.testAction");
  const balance = result.balance ? t("settings.models.balanceSuffix", { balance: result.balance }) : "";
  return t("settings.models.probeResult", {
    action: actionLabel,
    status: result.status,
    count: result.modelCount,
    url: result.url,
    ms: result.latencyMs,
    detail: result.detail,
    balance,
  });
}

function describeError(error: unknown, t?: I18nContextValue["t"]): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return t ? t("settings.models.unknownError") : "Unknown error";
}
