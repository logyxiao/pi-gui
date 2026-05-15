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
import { ToggleSwitch } from "./toggle-switch";

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
  const [editingProviderId, setEditingProviderId] = useState(false);
  const [providerQuery, setProviderQuery] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [balanceDialogOpen, setBalanceDialogOpen] = useState(false);
  const [balanceBaseUrlDraft, setBalanceBaseUrlDraft] = useState("");
  const [balanceApiKeyDraft, setBalanceApiKeyDraft] = useState("");
  const providerIds = useMemo(() => Object.keys(modelsJson.providers).sort((a, b) => a.localeCompare(b)), [modelsJson]);
  const filteredProviderIds = useMemo(() => {
    const query = providerQuery.trim().toLowerCase();
    if (!query) return providerIds;
    return providerIds.filter((providerId) => providerId.toLowerCase().includes(query));
  }, [providerIds, providerQuery]);
  const selectedProvider = selectedProviderId ? modelsJson.providers[selectedProviderId] : undefined;
  const selectedModels = selectedProvider?.models ?? [];
  const filteredSelectedModels = useMemo(() => {
    const entries = selectedModels.map((model, index) => ({ model, index }));
    const query = modelQuery.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter(({ model }) => [model.id, model.name ?? ""].some((value) => value.toLowerCase().includes(query)));
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
    setEditingProviderId(false);
    setBalanceDialogOpen(false);
    setBalanceBaseUrlDraft(selectedProvider?.balanceBaseUrl ?? "");
    setBalanceApiKeyDraft(selectedProvider?.balanceApiKey ?? "");
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
    const baseId = "new-provider";
    let id = baseId;
    let index = 2;
    while (modelsJson.providers[id]) {
      id = `${baseId}-${index}`;
      index += 1;
    }
    setModelsJson((current) => ({
      providers: {
        ...current.providers,
        [id]: { enabled: true, authHeader: true, baseUrl: "", api: "", apiKey: "", balanceBaseUrl: "", balanceApiKey: "", headers: {}, models: [] },
      },
    }));
    setProviderQuery("");
    setSelectedProviderId(id);
    setRenameValue(id);
    setEditingProviderId(true);
    setStatus({ kind: "ok", text: t("settings.models.providerAdded", { id }) });
  };

  const renameProvider = () => {
    const nextId = renameValue.trim();
    if (!selectedProviderId || !selectedProvider || !nextId) {
      setRenameValue(selectedProviderId);
      setEditingProviderId(false);
      return;
    }
    if (nextId === selectedProviderId) {
      setEditingProviderId(false);
      return;
    }
    if (modelsJson.providers[nextId]) {
      setStatus({ kind: "error", text: t("settings.models.providerExists", { id: nextId }) });
      setRenameValue(selectedProviderId);
      setEditingProviderId(false);
      return;
    }
    const { [selectedProviderId]: _old, ...rest } = modelsJson.providers;
    setModelsJson({ providers: { ...rest, [nextId]: selectedProvider } });
    setSelectedProviderId(nextId);
    setEditingProviderId(false);
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

  const openBalanceDialog = () => {
    setBalanceBaseUrlDraft(selectedProvider?.balanceBaseUrl ?? "");
    setBalanceApiKeyDraft(selectedProvider?.balanceApiKey ?? "");
    setBalanceDialogOpen(true);
  };

  const applyBalanceSettings = () => {
    if (!selectedProviderId) return;
    setProvider(selectedProviderId, (provider) => ({
      ...provider,
      balanceBaseUrl: balanceBaseUrlDraft,
      balanceApiKey: balanceApiKeyDraft,
    }));
    setBalanceDialogOpen(false);
    setStatus({ kind: "ok", text: t("settings.models.balanceSaved") });
  };

  const addModel = () => {
    if (!selectedProviderId) return;
    setModelQuery("");
    setProvider(selectedProviderId, (provider) => ({ ...provider, models: [...(provider.models ?? []), { id: "", enabled: true }] }));
  };

  const updateModel = (modelIndex: number, updater: (model: ModelsJsonModelConfig) => ModelsJsonModelConfig) => {
    if (!selectedProviderId) return;
    setProvider(selectedProviderId, (provider) => ({
      ...provider,
      models: (provider.models ?? []).map((model, index) => (index === modelIndex ? updater(model) : model)),
    }));
  };

  const deleteModel = (modelIndex: number) => {
    if (!selectedProviderId) return;
    setProvider(selectedProviderId, (provider) => ({
      ...provider,
      models: (provider.models ?? []).filter((_model, index) => index !== modelIndex),
    }));
  };

  const save = async () => {
    if (!window.piApp) return;
    setSaving(true);
    try {
      const result = await window.piApp.writeModelsJson(modelsJson);
      const patterns = await window.piApp.syncEnabledModels(modelsJson);
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
      const providerInput = { ...selectedProvider, headers: selectedProvider.headers ?? {}, baseUrl: selectedProvider.baseUrl ?? "" };
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
      if (action === "probe" && result.status === "ok" && result.balance) {
        setProvider(selectedProviderId, (provider) => ({
          ...provider,
          usageLastValue: result.balance,
          usageLastCheckedAt: new Date().toISOString(),
        }));
        void persistProviderUsageResult(selectedProviderId, result.balance);
      }
      setStatus({ kind: result.status === "ok" ? "ok" : "error", text: formatProbeResult(action, result, t) });
    } catch (error) {
      setStatus({ kind: "error", text: describeError(error, t) });
    }
  };

  const persistProviderUsageResult = async (providerId: string, usageLastValue: string) => {
    if (!window.piApp) return;
    const usageLastCheckedAt = new Date().toISOString();
    const nextModelsJson = {
      providers: {
        ...modelsJson.providers,
        [providerId]: {
          ...(modelsJson.providers[providerId] ?? {}),
          usageLastValue,
          usageLastCheckedAt,
        },
      },
    };
    try {
      await window.piApp.writeModelsJson(nextModelsJson);
      onRefreshRuntime?.();
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

  const syncCcSwitch = async () => {
    if (!window.piApp) return;
    setSaving(true);
    try {
      const result = await window.piApp.syncCcSwitchProviders();
      const file = await window.piApp.readModelsJson();
      const ids = Object.keys(file.providers).sort((a, b) => a.localeCompare(b));
      setModelsJson(file);
      setSelectedProviderId((current) => current && file.providers[current] ? current : ids[0] ?? "");
      onRefreshRuntime?.();
      setStatus({ kind: "ok", text: t("settings.models.syncedCcSwitch", { providers: result.importedProviderCount, models: result.importedModelCount, patterns: result.syncedPatternCount }) });
    } catch (error) {
      setStatus({ kind: "error", text: describeError(error, t) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsGroup title={t("settings.models.advanced")} description={t("settings.models.advancedDescription")}>
      <div className="model-manager__toolbar">
        <div className="settings-row__actions model-manager__toolbar-actions">
          <button className="button button--secondary model-manager__strong-button" disabled={loading} type="button" onClick={() => window.piApp?.readModelsJson().then((file) => setModelsJson(file)).catch((error) => setStatus({ kind: "error", text: describeError(error, t) }))}>{t("settings.models.reload")}</button>
          <button className="button button--secondary model-manager__strong-button" disabled={saving} type="button" onClick={() => void syncCcSwitch()}>{t("settings.models.syncCcSwitch")}</button>
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
            <button className="model-manager__icon-button" type="button" aria-label={t("settings.models.addProvider")} title={t("settings.models.addProvider")} onClick={addProvider}>
              +
            </button>
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
                <span className="model-manager__provider-copy">
                  <span className="model-manager__provider-name">{providerId}</span>
                  <span className="model-manager__provider-meta">{provider.models?.length ?? 0}</span>
                </span>
                <ToggleSwitch
                  checked={enabled}
                  label={t("settings.models.providerEnabled")}
                  onChange={(checked) => setProvider(providerId, (provider) => ({ ...provider, enabled: checked }))}
                />
              </button>
            );
          })}
          {providerIds.length > 0 && filteredProviderIds.length === 0 ? <div className="settings-hint">{t("settings.models.noProviders")}</div> : null}
        </aside>
        {selectedProvider && selectedProviderId ? (
          <div className="model-manager__workspace">
            <section className="model-manager__config" aria-label={t("settings.models.providerId")}>
              <div className="model-manager__panel-head">
                <div className="model-manager__provider-title">
                  <div className="model-manager__section-label">{t("settings.models.providerId")}</div>
                  {editingProviderId ? (
                    <input
                      autoFocus
                      className="settings-text-input model-manager__provider-name-input"
                      value={renameValue}
                      onBlur={renameProvider}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.currentTarget.blur();
                        }
                        if (event.key === "Escape") {
                          setRenameValue(selectedProviderId);
                          setEditingProviderId(false);
                        }
                      }}
                    />
                  ) : (
                    <button className="model-manager__provider-title-button" type="button" onDoubleClick={() => setEditingProviderId(true)}>
                      {selectedProviderId}
                    </button>
                  )}
                </div>
                <div className="model-manager__toggles">
                  <button className="button button--secondary model-manager__strong-button" type="button" onClick={() => void runProviderAction("test")}>{t("settings.models.test")}</button>
                  <button className="button button--secondary model-manager__strong-button" type="button" onClick={deleteProvider}>{t("settings.models.delete")}</button>
                </div>
              </div>
              <div className="model-manager__compact-grid">
                <label className="settings-field">{t("settings.models.baseUrl")}<input className="settings-text-input" value={selectedProvider.baseUrl ?? ""} onChange={(event) => setProvider(selectedProviderId, (provider) => ({ ...provider, baseUrl: event.target.value }))} /></label>
                <label className="settings-field">{t("settings.models.apiType")}<input className="settings-text-input" placeholder={t("settings.models.apiTypePlaceholder")} value={selectedProvider.api ?? ""} onChange={(event) => setProvider(selectedProviderId, (provider) => ({ ...provider, api: event.target.value }))} /></label>
                <label className="settings-field">{t("settings.models.apiKey")}<input className="settings-text-input" type="password" value={selectedProvider.apiKey ?? ""} onChange={(event) => setProvider(selectedProviderId, (provider) => ({ ...provider, apiKey: event.target.value }))} /></label>
              </div>
              <div className="settings-row__actions model-manager__actions">
                <button className="button button--secondary" type="button" onClick={openBalanceDialog}>{t("settings.models.usageSettings")}</button>
                <button className="button button--secondary" type="button" onClick={() => void runProviderAction("fetch")}>{t("settings.models.fetchModels")}</button>
                <button className="button button--secondary model-manager__usage-button" type="button" title={selectedProvider.usageLastCheckedAt ?? undefined} onClick={() => void runProviderAction("probe")}>
                  {selectedProvider.usageLastValue ? <span className="model-manager__usage-value">{selectedProvider.usageLastValue}</span> : null}
                  <span>{t("settings.models.queryUsage")}</span>
                </button>
              </div>
            </section>
            <section className="model-manager__models-panel" aria-label={t("settings.models.models")}>
              <div className="model-manager__models-head">
                <div className="model-manager__models-title">
                  <div className="model-manager__section-label">{t("settings.models.models")}</div>
                  <input className="settings-search model-manager__filter" placeholder={t("settings.models.searchModels")} value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} />
                </div>
                <button className="button button--secondary model-manager__strong-button" type="button" onClick={addModel}>{t("settings.models.addModel")}</button>
              </div>
              <div className="model-manager__models">
                {filteredSelectedModels.map(({ model, index }) => (
                  <div className="model-manager__model" key={`${index}:${model.id}`}>
                    <div className="model-manager__model-main">
                      <ToggleSwitch checked={model.enabled !== false} label={t("settings.models.enabled")} onChange={(checked) => updateModel(index, (current) => ({ ...current, enabled: checked }))} />
                      <input className="settings-text-input" placeholder={t("settings.models.modelId")} value={model.id} onChange={(event) => updateModel(index, (current) => ({ ...current, id: event.target.value }))} />
                    </div>
                    <div className="model-manager__model-extra">
                      <input className="settings-text-input" placeholder={t("settings.models.displayName")} value={model.name ?? ""} onChange={(event) => updateModel(index, (current) => ({ ...current, name: event.target.value }))} />
                      <label className="settings-toggle"><input checked={model.reasoning === true} type="checkbox" onChange={(event) => updateModel(index, (current) => ({ ...current, reasoning: event.target.checked }))} />{t("settings.models.reasoning")}</label>
                      <button className="button button--secondary" type="button" onClick={() => deleteModel(index)}>{t("settings.models.delete")}</button>
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
      {balanceDialogOpen ? (
        <div className="model-manager-dialog" role="dialog" aria-modal="true" aria-label={t("settings.models.balanceSettings")}>
          <div className="model-manager-dialog__backdrop" onClick={() => setBalanceDialogOpen(false)} />
          <div className="model-manager-dialog__panel">
            <div className="model-manager-dialog__head">
              <div>
                <div className="model-manager__section-label">{selectedProviderId}</div>
                <strong>{t("settings.models.balanceSettings")}</strong>
              </div>
              <button className="model-manager__icon-button" type="button" aria-label={t("common.close")} onClick={() => setBalanceDialogOpen(false)}>×</button>
            </div>
            <div className="model-manager-dialog__body">
              <label className="settings-field">{t("settings.models.balanceUrl")}<input className="settings-text-input" value={balanceBaseUrlDraft} onChange={(event) => setBalanceBaseUrlDraft(event.target.value)} /></label>
              <label className="settings-field">{t("settings.models.balanceKey")}<input className="settings-text-input" type="password" value={balanceApiKeyDraft} onChange={(event) => setBalanceApiKeyDraft(event.target.value)} /></label>
            </div>
            <div className="model-manager-dialog__actions">
              <button className="button button--secondary" type="button" onClick={() => setBalanceDialogOpen(false)}>{t("common.cancel")}</button>
              <button className="button button--primary" type="button" onClick={applyBalanceSettings}>{t("common.save")}</button>
            </div>
          </div>
        </div>
      ) : null}
    </SettingsGroup>
  );
}

interface StatusMessage {
  readonly kind: "ok" | "error";
  readonly text: string;
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
