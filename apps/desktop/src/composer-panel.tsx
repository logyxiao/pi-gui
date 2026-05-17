import { memo, useCallback, useEffect, useMemo, useState, type ClipboardEvent, type Dispatch, type DragEvent, type KeyboardEvent, type RefObject, type SetStateAction } from "react";
import type { SessionContextUsage } from "@pi-gui/session-driver";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ComposerAttachment, QueuedComposerMessage, SessionRecord } from "./desktop-state";
import { ArrowUpIcon, DashboardIcon, PlusIcon, StopSquareIcon } from "./icons";
import type {
  ComposerSlashCommand,
  ComposerSlashCommandSection,
  ComposerSlashOption,
  ComposerSlashOptionEmptyState,
} from "./composer-commands";
import { ComposerSurface } from "./composer-surface";
import { useI18n } from "./i18n";
import { ModelOnboardingNoticeBanner } from "./model-onboarding-notice";
import type { ModelOnboardingState, ModelOnboardingSettingsSection } from "./model-onboarding";
import { ModelSelector } from "./model-selector";
import type { ExtensionDockModel } from "./extension-session-ui";

export interface ComposerPanelProps {
  readonly selectedSession: SessionRecord;
  readonly lastError?: string;
  readonly runtime?: RuntimeSnapshot;
  readonly contextUsage?: SessionContextUsage;
  readonly activeSlashCommand?: ComposerSlashCommand;
  readonly activeSlashCommandMeta?: string;
  readonly composerDraft: string;
  readonly setComposerDraft: Dispatch<SetStateAction<string>>;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly runningLabel: string;
  readonly attachments: readonly ComposerAttachment[];
  readonly queuedMessages: readonly QueuedComposerMessage[];
  readonly editingQueuedMessageId?: string;
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: string | undefined;
  readonly slashSections: readonly ComposerSlashCommandSection[];
  readonly slashOptions: readonly ComposerSlashOption[];
  readonly selectedSlashCommand?: ComposerSlashCommand;
  readonly selectedSlashOption?: ComposerSlashOption;
  readonly showSlashMenu: boolean;
  readonly showSlashOptionMenu: boolean;
  readonly slashOptionEmptyState?: ComposerSlashOptionEmptyState;
  readonly onClearSlashCommand: () => void;
  readonly onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly onComposerPaste: (event: ClipboardEvent<HTMLDivElement>) => void;
  readonly onComposerDrop: (event: DragEvent<HTMLDivElement>) => void;
  readonly onPickAttachments: () => void;
  readonly onRemoveAttachment: (attachmentId: string) => void;
  readonly onEditQueuedMessage: (messageId: string) => void;
  readonly onCancelQueuedEdit: () => void;
  readonly onRemoveQueuedMessage: (messageId: string) => void;
  readonly onSteerQueuedMessage: (messageId: string) => void;
  readonly onSelectSlashCommand: (command: ComposerSlashCommand) => void;
  readonly onSelectSlashOption: (option: ComposerSlashOption) => void;
  readonly onSetModel: (provider: string, modelId: string) => void;
  readonly onSetThinking: (level: string) => void;
  readonly modelOnboarding: ModelOnboardingState;
  readonly onOpenModelSettings: (section: ModelOnboardingSettingsSection) => void;
  readonly onSubmit: () => void;
  readonly showMentionMenu: boolean;
  readonly mentionOptions: readonly string[];
  readonly selectedMentionIndex: number;
  readonly onSelectMention: (filePath: string) => void;
  readonly extensionDock?: ExtensionDockModel;
  readonly extensionDockExpanded: boolean;
  readonly onToggleExtensionDock: () => void;
}

function ComposerPanelComponent({
  selectedSession,
  lastError,
  runtime,
  contextUsage,
  activeSlashCommand,
  activeSlashCommandMeta,
  composerDraft,
  setComposerDraft,
  composerRef,
  runningLabel,
  attachments,
  queuedMessages,
  editingQueuedMessageId,
  provider,
  modelId,
  thinkingLevel,
  slashSections,
  slashOptions,
  selectedSlashCommand,
  selectedSlashOption,
  showSlashMenu,
  showSlashOptionMenu,
  slashOptionEmptyState,
  onClearSlashCommand,
  onComposerKeyDown,
  onComposerPaste,
  onComposerDrop,
  onPickAttachments,
  onRemoveAttachment,
  onEditQueuedMessage,
  onCancelQueuedEdit,
  onRemoveQueuedMessage,
  onSteerQueuedMessage,
  onSelectSlashCommand,
  onSelectSlashOption,
  onSetModel,
  onSetThinking,
  modelOnboarding,
  onOpenModelSettings,
  onSubmit,
  showMentionMenu,
  mentionOptions,
  selectedMentionIndex,
  onSelectMention,
  extensionDock,
  extensionDockExpanded,
  onToggleExtensionDock,
}: ComposerPanelProps) {
  const { t } = useI18n();
  const hasComposerInput = composerDraft.trim().length > 0 || attachments.length > 0;
  const primaryActionIsStop = selectedSession.status === "running" && !hasComposerInput;
  const [persistedUsage, setPersistedUsage] = useState<ComposerProviderUsage>({});
  const [refreshingUsage, setRefreshingUsage] = useState(false);
  const [usageError, setUsageError] = useState<string | undefined>();
  const contextUnknownLabel = t("composer.contextUnknown");
  const contextStatus = useMemo(
    () => buildComposerContextStatus(
      runtime,
      provider,
      modelId,
      selectedSession.preview,
      composerDraft,
      contextUnknownLabel,
      contextUsage,
      persistedUsage.contextWindow,
      persistedUsage.balance,
    ),
    [
      composerDraft,
      contextUsage,
      contextUnknownLabel,
      modelId,
      persistedUsage.balance,
      persistedUsage.contextWindow,
      provider,
      runtime,
      selectedSession.preview,
    ],
  );
  const submitShortcut = selectedSession.status === "running"
    ? t("composer.sendShortcutRunning")
    : t("composer.sendShortcutIdle");

  const loadPersistedUsage = useCallback(async () => {
    if (!provider || !window.piApp) {
      setPersistedUsage({});
      return;
    }
    try {
      const modelsJson = await window.piApp.readModelsJson();
      const providerConfig = modelsJson.providers[provider];
      const modelConfig = providerConfig?.models?.find((entry) => entry.id === modelId);
      setPersistedUsage({
        ...(providerConfig?.usageLastValue ? { balance: providerConfig.usageLastValue } : {}),
        ...(providerConfig?.usageLastCheckedAt ? { checkedAt: providerConfig.usageLastCheckedAt } : {}),
        ...(typeof modelConfig?.contextWindow === "number" ? { contextWindow: modelConfig.contextWindow } : {}),
      });
      setUsageError(undefined);
    } catch (error) {
      setUsageError(describeComposerUsageError(error));
    }
  }, [modelId, provider]);

  useEffect(() => {
    void loadPersistedUsage();
  }, [loadPersistedUsage]);

  const refreshProviderUsage = useCallback(async () => {
    if (!provider || !window.piApp || refreshingUsage) {
      return;
    }
    setRefreshingUsage(true);
    setUsageError(undefined);
    try {
      const modelsJson = await window.piApp.readModelsJson();
      const providerConfig = modelsJson.providers[provider];
      if (!providerConfig?.baseUrl?.trim()) {
        setUsageError(t("composer.balanceRefreshUnavailable"));
        return;
      }
      const result = await window.piApp.probeProvider({
        ...providerConfig,
        headers: providerConfig.headers ?? {},
        baseUrl: providerConfig.baseUrl,
      });
      if (result.status !== "ok" || !result.balance) {
        setUsageError(result.detail || t("composer.balanceRefreshFailed"));
        return;
      }
      const checkedAt = new Date().toISOString();
      const nextModelsJson = {
        providers: {
          ...modelsJson.providers,
          [provider]: {
            ...providerConfig,
            usageLastValue: result.balance,
            usageLastCheckedAt: checkedAt,
          },
        },
      };
      await window.piApp.writeModelsJson(nextModelsJson);
      setPersistedUsage((current) => ({ ...current, balance: result.balance, checkedAt }));
    } catch (error) {
      setUsageError(describeComposerUsageError(error));
    } finally {
      setRefreshingUsage(false);
    }
  }, [provider, refreshingUsage, t]);

  return (
    <footer className="composer">
      <div className="conversation conversation--composer">
        <ComposerSurface
          lastError={lastError}
          activeSlashCommand={activeSlashCommand}
          activeSlashCommandMeta={activeSlashCommandMeta}
          topNotice={(
            <ModelOnboardingNoticeBanner notice={modelOnboarding.notice} onOpenSettings={onOpenModelSettings} />
          )}
          composerDraft={composerDraft}
          setComposerDraft={setComposerDraft}
          composerRef={composerRef}
          attachments={attachments}
          queuedMessages={queuedMessages}
          editingQueuedMessageId={editingQueuedMessageId}
          slashSections={slashSections}
          slashOptions={slashOptions}
          selectedSlashCommand={selectedSlashCommand}
          selectedSlashOption={selectedSlashOption}
          showSlashMenu={showSlashMenu}
          showSlashOptionMenu={showSlashOptionMenu}
          slashOptionEmptyState={slashOptionEmptyState}
          onClearSlashCommand={onClearSlashCommand}
          onComposerKeyDown={onComposerKeyDown}
          onComposerPaste={onComposerPaste}
          onComposerDrop={onComposerDrop}
          onRemoveAttachment={onRemoveAttachment}
          onEditQueuedMessage={onEditQueuedMessage}
          onCancelQueuedEdit={onCancelQueuedEdit}
          onRemoveQueuedMessage={onRemoveQueuedMessage}
          onSteerQueuedMessage={onSteerQueuedMessage}
          onSelectSlashCommand={onSelectSlashCommand}
          onSelectSlashOption={onSelectSlashOption}
          showMentionMenu={showMentionMenu}
          mentionOptions={mentionOptions}
          selectedMentionIndex={selectedMentionIndex}
          onSelectMention={onSelectMention}
          textareaLabel={t("composer.label")}
          textareaTestId="composer"
          textareaPlaceholder={t("composer.placeholder")}
          extensionDock={extensionDock}
          extensionDockExpanded={extensionDockExpanded}
          onToggleExtensionDock={onToggleExtensionDock}
          footer={(
            <div className="composer__footer">
              <div className="composer__footer-row">
                <div className="composer__hint">
                  {selectedSession.status === "running" ? (
                    <span className="composer__status-text">{t("composer.runningStatus", { status: runningLabel })}</span>
                  ) : null}
                  <ModelSelector
                    runtime={runtime}
                    provider={provider}
                    modelId={modelId}
                    thinkingLevel={thinkingLevel}
                    disabled={selectedSession.status === "running"}
                    unselectedModelLabel={modelOnboarding.unselectedModelLabel}
                    emptyModelTitle={modelOnboarding.emptyModelTitle}
                    emptyModelDescription={modelOnboarding.emptyModelDescription}
                    onSetModel={onSetModel}
                    onSetThinking={onSetThinking}
                  />
                </div>
                <div className="composer__actions">
                  <div className="composer__action-tooltip-wrap">
                    <button
                      aria-label={t("composer.contextStatus")}
                      className="icon-button composer__action-button composer__context-button"
                      type="button"
                    >
                      <DashboardIcon />
                    </button>
                    <div className="composer__action-tooltip composer__context-tooltip" role="tooltip">
                      <div className="composer__tooltip-title">{t("composer.contextStatus")}</div>
                      <div className="composer__meter" aria-hidden="true">
                        <span style={{ width: `${contextStatus.percent}%` }} />
                      </div>
                      <div className="composer__tooltip-row">
                        <span>{t("composer.contextUsage")}</span>
                        <strong>{contextStatus.label}</strong>
                      </div>
                      <div className="composer__tooltip-row composer__tooltip-row--balance">
                        <span>{t("composer.providerBalance")}</span>
                        <span className="composer__balance-value">
                          <strong>{refreshingUsage ? t("composer.balanceRefreshing") : contextStatus.balance ?? t("composer.balanceUnavailable")}</strong>
                          <button
                            aria-label={t("composer.refreshBalance")}
                            className="icon-button composer__tooltip-refresh"
                            disabled={refreshingUsage || !provider}
                            type="button"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void refreshProviderUsage();
                            }}
                          >
                            ↻
                          </button>
                        </span>
                      </div>
                      {persistedUsage.checkedAt ? (
                        <div className="composer__tooltip-note">{t("composer.balanceLastChecked", { time: formatUsageCheckedAt(persistedUsage.checkedAt) })}</div>
                      ) : null}
                      {usageError ? <div className="composer__tooltip-error">{usageError}</div> : null}
                    </div>
                  </div>
                  <button
                    aria-label={t("composer.attachFiles")}
                    className="icon-button composer__action-button"
                    type="button"
                    onClick={onPickAttachments}
                  >
                    <PlusIcon />
                  </button>
                  <div className="composer__action-tooltip-wrap">
                    <button
                      aria-label={primaryActionIsStop ? t("composer.stopRun") : t("composer.sendMessage")}
                      className="icon-button composer__action-button composer__send-button"
                      data-testid="send"
                      type="button"
                      disabled={
                        !primaryActionIsStop &&
                        ((!composerDraft.trim() && attachments.length === 0) || modelOnboarding.requiresModelSelection)
                      }
                      onClick={onSubmit}
                    >
                      {primaryActionIsStop ? <StopSquareIcon /> : <ArrowUpIcon />}
                    </button>
                    <div className="composer__action-tooltip" role="tooltip">
                      {primaryActionIsStop ? t("composer.stopRun") : submitShortcut}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        />
      </div>
    </footer>
  );
}

export const ComposerPanel = memo(ComposerPanelComponent);

interface ComposerContextStatus {
  readonly percent: number;
  readonly label: string;
  readonly balance?: string;
}

interface ComposerProviderUsage {
  readonly balance?: string;
  readonly checkedAt?: string;
  readonly contextWindow?: number;
}

function buildComposerContextStatus(
  runtime: RuntimeSnapshot | undefined,
  provider: string | undefined,
  modelId: string | undefined,
  sessionPreview: string,
  composerDraft: string,
  unknownLabel: string,
  contextUsage: SessionContextUsage | undefined,
  persistedContextWindow: number | undefined,
  persistedBalance: string | undefined,
): ComposerContextStatus {
  const model = runtime?.models.find((entry) => entry.providerId === provider && entry.modelId === modelId);
  const contextWindow = contextUsage?.contextWindow ?? readRuntimeModelNumber(model, "contextWindow") ?? readRuntimeModelNumber(model, "maxTokens") ?? persistedContextWindow;
  const fallbackTokens = estimateTokenCount(`${sessionPreview}\n${composerDraft}`);
  const tokens = contextUsage?.tokens ?? fallbackTokens;
  const percent = typeof contextUsage?.percent === "number"
    ? clamp(Math.round(contextUsage.percent), 0, 100)
    : contextWindow
      ? clamp(Math.round((tokens / contextWindow) * 100), 0, 100)
      : 0;
  const balance = persistedBalance ?? readRuntimeProviderString(
    runtime?.providers.find((entry) => entry.id === provider),
    "usageLastValue",
  );

  return {
    percent,
    label: contextWindow ? `${percent}% · ${formatCompactNumber(tokens)} / ${formatCompactNumber(contextWindow)}` : unknownLabel,
    ...(balance ? { balance } : {}),
  };
}

function estimateTokenCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

function readRuntimeModelNumber(model: unknown, key: "contextWindow" | "maxTokens"): number | undefined {
  if (!model || typeof model !== "object") {
    return undefined;
  }
  const value = (model as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function readRuntimeProviderString(provider: unknown, key: "usageLastValue"): string | undefined {
  if (!provider || typeof provider !== "object") {
    return undefined;
  }
  const value = (provider as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatUsageCheckedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function describeComposerUsageError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
