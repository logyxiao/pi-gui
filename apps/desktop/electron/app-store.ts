import type { BrowserWindow } from "electron";
import { join } from "node:path";
import {
  applyHostUiRequestToExtensionUiState,
  type GenerateCommitMessageOptions,
  type GenerateThreadTitleOptions,
  isExtensionUiDialogRequest,
  JsonCatalogStore,
  PiSdkDriver,
  type PiSdkDriverConfig,
  sessionKey,
} from "@pi-gui/pi-sdk-driver";
import type { SessionCatalogEntry } from "@pi-gui/catalogs";
import type {
  NavigateSessionTreeOptions,
  NavigateSessionTreeResult,
  SessionTreeSnapshot,
} from "@pi-gui/session-driver/types";
import type {
  CreateSessionOptions,
  HostUiResponse,
  SessionConfig,
  SessionDriverEvent,
  SessionQueuedMessage,
  SessionRef,
  SessionSnapshot,
  WorkspaceRef,
} from "@pi-gui/session-driver";
import type {
  ModelSettingsSnapshot,
  RuntimeCommandRecord,
  RuntimeLoginCallbacks,
  RuntimeSettingsSnapshot,
  RuntimeSnapshot,
} from "@pi-gui/session-driver/runtime-types";
import {
  type AppView,
  type ComposerAttachment,
  type ComposerDraftSyncSource,
  type ExtensionCommandCompatibilityRecord,
  type ModelSettingsScopeMode,
  createEmptyDesktopAppState,
  type CreateSessionInput,
  type CreateWorktreeInput,
  type DesktopAppState,
  type NotificationPreferences,
  type QueuedComposerMessage,
  type RemoveWorktreeInput,
  type SelectedTranscriptDelta,
  type SelectedTranscriptRecord,
  type StartThreadInput,
  type TranscriptMessage,
  type WorkspaceSessionTarget,
} from "../src/desktop-state";
import type { ProjectOpenAppId } from "../src/project-open-apps";
import {
  applyTimelineEvent,
  appendAssistantDelta,
  clearActiveAssistantMessage,
} from "./app-store-timeline";
import { applySessionEventState, updateSessionRecord } from "./app-store-session-state";
import type { AppStoreInternals, RefreshStateOptions } from "./app-store-internals";
import {
  readPersistedUiState,
  type LegacyPersistedUiState,
  type PersistedUiState,
  writePersistedUiState,
} from "./app-store-persistence";
import { JsonFileStore } from "./json-file-store";
import {
  type PendingRuntimeCommandExecution,
  getLearnedCommandCompatibility,
  pruneCompatibilityForRuntimeSnapshot,
  recordLearnedCommandCompatibility,
  restoreCompatibilityByWorkspace,
  serializeCompatibilityByWorkspace,
} from "./extension-command-compatibility";
import {
  buildWorktreeRecords,
  buildWorkspaceRecords,
  cloneComposerAttachment,
  cloneComposerAttachments,
  cloneTranscriptMessage,
  latestSessionActivityAt,
  mergeQueuedComposerMessages,
  mapToRecord,
  previewFromTranscript,
  toSessionQueuedMessages,
  toSessionRef,
} from "./app-store-utils";
import { resolveRepoWorkspaceId } from "../src/workspace-roots";
import { SessionStateMap, type QueuedComposerEditState } from "./session-state-map";
import { createEmptyExtensionUiState, serializeExtensionUiState } from "./session-state-map";
import { GitWorktreeManager } from "./worktree-manager";
import * as workspace from "./app-store-workspace";
import * as worktree from "./app-store-worktree";
import * as composer from "./app-store-composer";
import * as runtime from "./app-store-runtime";
import {
  applyModelSettingsSnapshot,
  hasStoredModelSettings,
  mergeEnabledModelPatterns,
  mergeModelSettingsSnapshot,
  modelSettingsEqual,
  readProjectModelSettingsFile,
  updateProjectModelSettingsFile,
} from "./app-store-model-settings";
import { isSessionActivelyViewed } from "./session-visibility";

type StateListener = (state: DesktopAppState) => void;
type SelectedTranscriptListener = (payload: SelectedTranscriptRecord | null) => void;
type SelectedTranscriptDeltaListener = (payload: SelectedTranscriptDelta) => void;
type SessionEventListener = (event: SessionDriverEvent, state: DesktopAppState) => void | Promise<void>;
type TranscriptMessageRow = Extract<TranscriptMessage, { kind: "message" }>;

const LEGACY_TRANSCRIPT_HISTORY_LIMIT = 180;

interface PersistedTranscriptRecord {
  readonly version: 1;
  readonly transcript: readonly TranscriptMessage[];
}

type PersistedTranscriptStoreValue = PersistedTranscriptRecord | readonly TranscriptMessage[];

function isPersistedTranscriptRecord(value: PersistedTranscriptStoreValue): value is PersistedTranscriptRecord {
  if (Array.isArray(value)) {
    return false;
  }
  const candidate = value as { version?: unknown; transcript?: unknown };
  return candidate.version === 1 && Array.isArray(candidate.transcript);
}

export interface DesktopAppStoreOptions {
  readonly userDataDir: string;
  readonly initialWorkspacePaths: readonly string[];
  readonly getWindow?: () => BrowserWindow | null;
  readonly generateThreadTitleOverride?: (
    workspace: WorkspaceRef,
    options: GenerateThreadTitleOptions,
  ) => Promise<string | null | undefined>;
  readonly generateCommitMessageOverride?: (
    workspace: WorkspaceRef,
    options: GenerateCommitMessageOptions,
  ) => Promise<string | null | undefined>;
}

export class DesktopAppStore implements AppStoreInternals {
  state = createEmptyDesktopAppState();
  private readonly listeners = new Set<StateListener>();
  private readonly selectedTranscriptListeners = new Set<SelectedTranscriptListener>();
  private readonly selectedTranscriptDeltaListeners = new Set<SelectedTranscriptDeltaListener>();
  private readonly sessionEventListeners = new Set<SessionEventListener>();
  readonly driver: PiSdkDriver;
  readonly catalogStore: JsonCatalogStore;
  readonly worktreeManager: GitWorktreeManager;
  private readonly uiStateFilePath: string;
  private readonly transcriptStore: JsonFileStore<PersistedTranscriptStoreValue>;
  readonly attachmentStore: JsonFileStore<ComposerAttachment[]>;
  readonly sessionState = new SessionStateMap();
  readonly runtimeByWorkspace = new Map<string, RuntimeSnapshot>();
  readonly extensionCommandCompatibilityByWorkspace = new Map<string, Map<string, ExtensionCommandCompatibilityRecord>>();
  readonly pendingRuntimeCommandsBySession = new Map<string, PendingRuntimeCommandExecution>();
  private readonly reportedCompatibilityIssuesBySession = new Map<string, Set<string>>();
  private readonly initialWorkspacePaths: readonly string[];
  private readonly getWindow: () => BrowserWindow | null;
  private persistUiStateTimer: NodeJS.Timeout | undefined;
  private readonly transcriptPersistTimers = new Map<string, NodeJS.Timeout>();
  private initPromise: Promise<void> | undefined;
  private selectionEpoch = 0;
  private refreshStateDepth = 0;

  constructor(options: DesktopAppStoreOptions) {
    const catalogFilePath = join(options.userDataDir, "catalogs.json");
    const driverOptions: PiSdkDriverConfig = {
      catalogFilePath,
      ...(options.generateThreadTitleOverride
        ? { generateThreadTitleOverride: options.generateThreadTitleOverride }
        : {}),
      ...(options.generateCommitMessageOverride
        ? { generateCommitMessageOverride: options.generateCommitMessageOverride }
        : {}),
    };

    this.driver = new PiSdkDriver(driverOptions);
    this.catalogStore = new JsonCatalogStore({ catalogFilePath });
    this.worktreeManager = new GitWorktreeManager({ catalogStorage: this.catalogStore });
    this.uiStateFilePath = join(options.userDataDir, "ui-state.json");
    this.transcriptStore = new JsonFileStore<PersistedTranscriptStoreValue>(options.userDataDir, "transcripts");
    this.attachmentStore = new JsonFileStore<ComposerAttachment[]>(options.userDataDir, "attachments");
    this.initialWorkspacePaths = options.initialWorkspacePaths;
    this.getWindow = options.getWindow ?? (() => null);
  }

  /* ── Lifecycle ──────────────────────────────────────────── */

  async initialize(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initializeInternal();
    }
    return this.initPromise;
  }

  async getState(): Promise<DesktopAppState> {
    await this.initialize();
    return structuredClone(this.state);
  }

  async getSelectedTranscript(): Promise<SelectedTranscriptRecord | null> {
    await this.initialize();
    const sessionRef = this.selectedSessionRef();
    if (!sessionRef) {
      return null;
    }
    await this.ensureTranscriptLoaded(sessionRef);
    return this.buildSelectedTranscriptRecord(sessionRef);
  }

  async flushPersistence(): Promise<void> {
    await this.initialize();
    if (this.persistUiStateTimer) {
      clearTimeout(this.persistUiStateTimer);
      this.persistUiStateTimer = undefined;
    }

    const pendingTranscriptWrites = [...this.transcriptPersistTimers.entries()];
    this.transcriptPersistTimers.clear();
    await Promise.all(
      pendingTranscriptWrites.map(async ([key, timer]) => {
        clearTimeout(timer);
        const transcript = (this.sessionState.transcriptCache.get(key) ?? []).map(cloneTranscriptMessage);
        await this.writePersistedTranscript(key, transcript);
      }),
    );

    await this.persistUiState();
  }

  async emitTestSessionEvent(event: SessionDriverEvent): Promise<void> {
    await this.initialize();
    await this.handleSessionEvent(event);
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    void this.getState().then(listener).catch(() => undefined);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeToSelectedTranscript(listener: SelectedTranscriptListener): () => void {
    this.selectedTranscriptListeners.add(listener);
    void this.getSelectedTranscript().then(listener).catch(() => undefined);
    return () => {
      this.selectedTranscriptListeners.delete(listener);
    };
  }

  subscribeToSelectedTranscriptDelta(listener: SelectedTranscriptDeltaListener): () => void {
    this.selectedTranscriptDeltaListeners.add(listener);
    return () => {
      this.selectedTranscriptDeltaListeners.delete(listener);
    };
  }

  subscribeToSessionEvents(listener: SessionEventListener): () => void {
    this.sessionEventListeners.add(listener);
    return () => {
      this.sessionEventListeners.delete(listener);
    };
  }

  /* ── Workspace methods (delegated) ─────────────────────── */

  async addWorkspace(path: string): Promise<DesktopAppState> {
    return workspace.addWorkspace(this, path);
  }

  getWorkspacePath(workspaceId: string): string | undefined {
    return this.state.workspaces.find((w) => w.id === workspaceId)?.path;
  }

  getSkillFilePath(workspaceId: string, filePath: string): string | undefined {
    return this.runtimeByWorkspace.get(workspaceId)?.skills.find((s) => s.filePath === filePath)?.filePath;
  }

  getExtensionFilePath(workspaceId: string, filePath: string): string | undefined {
    return this.runtimeByWorkspace.get(workspaceId)?.extensions.find((entry) => entry.path === filePath)?.path;
  }

  async renameWorkspace(workspaceId: string, displayName: string): Promise<DesktopAppState> {
    return workspace.renameWorkspace(this, workspaceId, displayName);
  }

  async removeWorkspace(workspaceId: string): Promise<DesktopAppState> {
    return workspace.removeWorkspace(this, workspaceId);
  }

  async reorderWorkspaces(order: readonly string[]): Promise<DesktopAppState> {
    await this.initialize();
    const primaryIds = new Set(this.state.workspaces.filter((w) => w.kind === "primary").map((w) => w.id));
    const sanitized = [...new Set(order)].filter((id) => primaryIds.has(id));
    this.state = {
      ...this.state,
      workspaceOrder: sanitized,
      lastError: undefined,
      revision: this.state.revision + 1,
    };
    await this.persistUiState();
    return this.emit();
  }

  async selectWorkspace(workspaceId: string): Promise<DesktopAppState> {
    return workspace.selectWorkspace(this, workspaceId);
  }

  async selectSession(target: WorkspaceSessionTarget): Promise<DesktopAppState> {
    return workspace.selectSession(this, target);
  }

  async selectSessionFast(target: WorkspaceSessionTarget): Promise<DesktopAppState> {
    await this.initialize();
    const sessionRef = toSessionRef(target);
    if (!this.sessionFromState(sessionRef)) {
      return this.withErrorHandling(async () =>
        this.refreshState({
          selectedWorkspaceId: target.workspaceId,
          selectedSessionId: target.sessionId,
          clearLastError: true,
          activeView: "threads",
        }),
      );
    }

    return this.withErrorHandling(async () => {
      const selectionEpoch = ++this.selectionEpoch;
      this.applyFastSessionSelection(sessionRef);
      try {
        await this.hydrateSelectedSessionAfterSelection(sessionRef, selectionEpoch);
      } catch (error) {
        await this.handleSelectedSessionHydrationError(sessionRef, selectionEpoch, error);
      }
      return structuredClone(this.state);
    });
  }

  async archiveSession(target: WorkspaceSessionTarget): Promise<DesktopAppState> {
    return workspace.archiveSession(this, target);
  }

  async unarchiveSession(target: WorkspaceSessionTarget): Promise<DesktopAppState> {
    return workspace.unarchiveSession(this, target);
  }

  async syncCurrentWorkspace(): Promise<DesktopAppState> {
    return workspace.syncCurrentWorkspace(this);
  }

  /* ── Worktree methods (delegated) ──────────────────────── */

  async createWorktree(input: CreateWorktreeInput): Promise<DesktopAppState> {
    return worktree.createWorktree(this, input);
  }

  async removeWorktree(input: RemoveWorktreeInput): Promise<DesktopAppState> {
    return worktree.removeWorktree(this, input);
  }

  /* ── Composer methods (delegated) ──────────────────────── */

  async updateComposerDraft(composerDraft: string): Promise<void> {
    return composer.updateComposerDraft(this, composerDraft);
  }

  async addComposerAttachments(attachments: readonly ComposerAttachment[]): Promise<DesktopAppState> {
    return composer.addComposerAttachments(this, attachments);
  }

  async removeComposerAttachment(attachmentId: string): Promise<DesktopAppState> {
    return composer.removeComposerAttachment(this, attachmentId);
  }

  async submitComposer(
    textInput: string,
    options?: { readonly deliverAs?: "steer" | "followUp" },
  ): Promise<DesktopAppState> {
    return composer.submitComposer(this, textInput, options);
  }

  async editQueuedComposerMessage(messageId: string, currentDraft?: string): Promise<DesktopAppState> {
    return composer.editQueuedComposerMessage(this, messageId, currentDraft);
  }

  async cancelQueuedComposerEdit(): Promise<DesktopAppState> {
    return composer.cancelQueuedComposerEdit(this);
  }

  async removeQueuedComposerMessage(messageId: string): Promise<DesktopAppState> {
    return composer.removeQueuedComposerMessage(this, messageId);
  }

  async steerQueuedComposerMessage(messageId: string): Promise<DesktopAppState> {
    return composer.steerQueuedComposerMessage(this, messageId);
  }

  async cancelCurrentRun(): Promise<DesktopAppState> {
    return composer.cancelCurrentRun(this);
  }

  async getSessionTree(target: WorkspaceSessionTarget): Promise<SessionTreeSnapshot> {
    await this.initialize();
    const sessionRef = toSessionRef(target);
    await this.ensureSessionReady(sessionRef);
    return this.driver.getSessionTree(sessionRef);
  }

  async navigateSessionTree(
    target: WorkspaceSessionTarget,
    targetId: string,
    options?: NavigateSessionTreeOptions,
  ): Promise<{ readonly state: DesktopAppState; readonly result: NavigateSessionTreeResult }> {
    await this.initialize();
    const sessionRef = toSessionRef(target);
    await this.ensureSessionReady(sessionRef);

    const result = await this.driver.navigateSessionTree(sessionRef, targetId, options);
    if (!result.cancelled && !result.aborted) {
      await this.reloadTranscriptFromDriver(sessionRef);
      await this.refreshSessionCommandsFor(sessionRef);
      const state = await this.refreshState({
        selectedWorkspaceId: target.workspaceId,
        selectedSessionId: target.sessionId,
        clearLastError: true,
        markSelectedSessionViewed: false,
      });
      return { state, result };
    }

    return {
      state: structuredClone(this.state),
      result,
    };
  }

  /* ── Session / thread methods (delegated) ───────────────── */

  async startThread(input: StartThreadInput): Promise<DesktopAppState> {
    return worktree.startThread(this, input);
  }

  async createSession(input: CreateSessionInput): Promise<DesktopAppState> {
    return workspace.createSession(this, input);
  }

  /* ── View / UI state ───────────────────────────────────── */

  async setActiveView(activeView: AppView): Promise<DesktopAppState> {
    await this.initialize();
    if (this.state.activeView === "threads" && activeView !== "threads") {
      const sessionRef = this.selectedSessionRef();
      if (sessionRef) {
        await this.cancelPendingDialogsForSession(sessionRef);
      }
    }
    this.state = {
      ...this.state,
      activeView,
      lastError: undefined,
      revision: this.state.revision + 1,
    };
    if (activeView === "threads") {
      this.markSelectedSessionViewedIfVisible();
    }
    await this.persistUiState();
    return this.emit();
  }

  async setSidebarCollapsed(sidebarCollapsed: boolean): Promise<DesktopAppState> {
    await this.initialize();
    if (this.state.sidebarCollapsed === sidebarCollapsed) {
      return structuredClone(this.state);
    }
    this.state = {
      ...this.state,
      sidebarCollapsed,
      lastError: undefined,
      revision: this.state.revision + 1,
    };
    await this.persistUiState();
    return this.emit();
  }

  async setNotificationPreferences(preferences: Partial<NotificationPreferences>): Promise<DesktopAppState> {
    await this.initialize();
    this.state = {
      ...this.state,
      notificationPreferences: {
        ...this.state.notificationPreferences,
        ...preferences,
      },
      lastError: undefined,
      revision: this.state.revision + 1,
    };
    await this.persistUiState();
    return this.emit();
  }

  async setIntegratedTerminalShell(integratedTerminalShell: string): Promise<DesktopAppState> {
    await this.initialize();
    const normalizedShell = integratedTerminalShell.trim();
    if (this.state.integratedTerminalShell === normalizedShell) {
      return this.emit();
    }
    this.state = {
      ...this.state,
      integratedTerminalShell: normalizedShell,
      lastError: undefined,
      revision: this.state.revision + 1,
    };
    await this.persistUiState();
    return this.emit();
  }

  async setLastProjectOpenApp(lastProjectOpenApp: ProjectOpenAppId): Promise<DesktopAppState> {
    await this.initialize();
    if (this.state.lastProjectOpenApp === lastProjectOpenApp) {
      return this.emit();
    }
    this.state = {
      ...this.state,
      lastProjectOpenApp,
      lastError: undefined,
      revision: this.state.revision + 1,
    };
    await this.persistUiState();
    return this.emit();
  }

  async setProjectStartCommand(workspaceId: string, command: string): Promise<DesktopAppState> {
    await this.initialize();
    const normalizedCommand = command.trim();
    const currentCommand = this.state.projectStartCommandsByWorkspace[workspaceId] ?? "";
    if (currentCommand === normalizedCommand) {
      return this.emit();
    }
    const projectStartCommandsByWorkspace = { ...this.state.projectStartCommandsByWorkspace };
    if (normalizedCommand) {
      projectStartCommandsByWorkspace[workspaceId] = normalizedCommand;
    } else {
      delete projectStartCommandsByWorkspace[workspaceId];
    }
    this.state = {
      ...this.state,
      projectStartCommandsByWorkspace,
      lastError: undefined,
      revision: this.state.revision + 1,
    };
    await this.persistUiState();
    return this.emit();
  }

  async setModelSettingsScopeMode(modelSettingsScopeMode: ModelSettingsScopeMode): Promise<DesktopAppState> {
    await this.initialize();
    if (this.state.modelSettingsScopeMode === modelSettingsScopeMode) {
      return this.emit();
    }
    if (modelSettingsScopeMode === "app-global") {
      await this.restoreGlobalModelSettings(this.state.globalModelSettings);
    }
    this.state = {
      ...this.state,
      modelSettingsScopeMode,
      lastError: undefined,
      revision: this.state.revision + 1,
    };
    await this.persistUiState();
    return this.refreshState({ clearLastError: true });
  }

  /* ── Runtime / model / provider settings ───────────────── */

  async refreshRuntime(workspaceId?: string): Promise<DesktopAppState> {
    return runtime.refreshRuntime(this, workspaceId);
  }

  async setSessionModel(target: WorkspaceSessionTarget, provider: string, modelId: string): Promise<DesktopAppState> {
    return runtime.setSessionModel(this, target, provider, modelId);
  }

  async setDefaultModel(workspaceId: string, provider: string, modelId: string): Promise<DesktopAppState> {
    return runtime.setDefaultModel(this, workspaceId, provider, modelId);
  }

  async setDefaultThinkingLevel(
    workspaceId: string,
    thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"],
  ): Promise<DesktopAppState> {
    return runtime.setDefaultThinkingLevel(this, workspaceId, thinkingLevel);
  }

  async setSessionThinkingLevel(
    sessionRef: SessionRef,
    thinkingLevel: NonNullable<RuntimeSettingsSnapshot["defaultThinkingLevel"]>,
  ): Promise<DesktopAppState> {
    return runtime.setSessionThinkingLevel(this, sessionRef, thinkingLevel);
  }

  async loginProvider(workspaceId: string, providerId: string, callbacks: RuntimeLoginCallbacks): Promise<DesktopAppState> {
    return runtime.loginProvider(this, workspaceId, providerId, callbacks);
  }

  async logoutProvider(workspaceId: string, providerId: string): Promise<DesktopAppState> {
    return runtime.logoutProvider(this, workspaceId, providerId);
  }

  async setProviderApiKey(workspaceId: string, providerId: string, apiKey: string): Promise<DesktopAppState> {
    return runtime.setProviderApiKey(this, workspaceId, providerId, apiKey);
  }

  async setEnableSkillCommands(workspaceId: string, enabled: boolean): Promise<DesktopAppState> {
    return runtime.setEnableSkillCommands(this, workspaceId, enabled);
  }

  async setScopedModelPatterns(workspaceId: string, patterns: readonly string[]): Promise<DesktopAppState> {
    return runtime.setScopedModelPatterns(this, workspaceId, patterns);
  }

  async autoEnableModelsForConnectedProvider(
    workspaceId: string,
    providerId: string,
    snapshot: RuntimeSnapshot,
  ): Promise<void> {
    const providerModelPatterns = [...new Set(
      snapshot.models
        .filter((model) => model.available && model.providerId === providerId)
        .map((model) => `${model.providerId}/${model.modelId}`),
    )];
    if (providerModelPatterns.length === 0) {
      return;
    }

    const currentPatterns = snapshot.settings.enabledModelPatterns;
    if (currentPatterns.length === 0) {
      return;
    }

    const nextPatterns = mergeEnabledModelPatterns(currentPatterns, providerModelPatterns);
    if (nextPatterns.length === currentPatterns.length) {
      return;
    }

    if (this.state.modelSettingsScopeMode !== "per-repo") {
      const ownerWorkspace = this.workspaceRefFromState(workspaceId);
      if (!ownerWorkspace) {
        return;
      }
      const updatedSnapshot = await this.driver.runtimeSupervisor.setScopedModelPatterns(ownerWorkspace, nextPatterns);
      this.runtimeByWorkspace.set(workspaceId, updatedSnapshot);
      return;
    }

    const ownerWorkspace = this.workspaceRefFromState(workspaceId);
    if (!ownerWorkspace) {
      return;
    }
    await updateProjectModelSettingsFile(ownerWorkspace.path, (settings) => ({
      ...settings,
      enabledModels: nextPatterns,
    }));
  }

  async setSkillEnabled(workspaceId: string, filePath: string, enabled: boolean): Promise<DesktopAppState> {
    return runtime.setSkillEnabled(this, workspaceId, filePath, enabled);
  }

  async setExtensionEnabled(workspaceId: string, filePath: string, enabled: boolean): Promise<DesktopAppState> {
    return runtime.setExtensionEnabled(this, workspaceId, filePath, enabled);
  }

  async withRuntimeUpdate(
    workspaceId: string,
    action: (ws: WorkspaceRef) => Promise<RuntimeSnapshot>,
    options?: {
      readonly reloadSessions?: boolean;
    },
  ): Promise<DesktopAppState> {
    await this.initialize();
    const ws = this.workspaceRefFromState(workspaceId);
    if (!ws) {
      return this.withError(`Unknown workspace: ${workspaceId}`);
    }

    return this.withErrorHandling(async () => {
      const snapshot = await action(ws);
      this.runtimeByWorkspace.set(workspaceId, snapshot);
      if (options?.reloadSessions) {
        this.clearExtensionUiForWorkspace(workspaceId);
        await this.reloadSessionsForWorkspace(workspaceId);
      }
      await this.refreshSessionCommandsForWorkspace(workspaceId);
      return this.refreshState({ clearLastError: true });
    });
  }

  /* ── Internal infrastructure (AppStoreInternals) ───────── */

  private async initializeInternal(): Promise<void> {
    try {
      const initializeStartedAt = Date.now();
      const readUiStateStartedAt = Date.now();
      const persisted = await this.readUiState();
      logSlowStartupStep("read UI state", readUiStateStartedAt);
      this.state = {
        ...this.state,
        activeView: persisted.activeView ?? this.state.activeView,
        modelSettingsScopeMode: persisted.modelSettingsScopeMode ?? this.state.modelSettingsScopeMode,
        globalModelSettings: persisted.appGlobalModelSettings ?? this.state.globalModelSettings,
        notificationPreferences: {
          ...this.state.notificationPreferences,
          ...persisted.notificationPreferences,
        },
        integratedTerminalShell: persisted.integratedTerminalShell ?? this.state.integratedTerminalShell,
        lastProjectOpenApp: persisted.lastProjectOpenApp ?? this.state.lastProjectOpenApp,
        projectStartCommandsByWorkspace: persisted.projectStartCommandsByWorkspace ?? {},
        lastViewedAtBySession: persisted.lastViewedAtBySession ?? {},
        workspaceOrder: persisted.workspaceOrder ?? [],
        sidebarCollapsed: persisted.sidebarCollapsed ?? this.state.sidebarCollapsed,
      };
      const migrateStartedAt = Date.now();
      await this.migrateLegacyPersistence(persisted);
      logSlowStartupStep("migrate legacy persistence", migrateStartedAt);
      this.sessionState.lastViewedAtBySession.clear();
      for (const [key, viewedAt] of Object.entries(persisted.lastViewedAtBySession ?? {})) {
        if (viewedAt) {
          this.sessionState.lastViewedAtBySession.set(key, viewedAt);
        }
      }
      this.sessionState.composerDraftsBySession.clear();
      for (const [key, draft] of Object.entries(persisted.composerDraftsBySession ?? {})) {
        if (draft) {
          this.sessionState.composerDraftsBySession.set(key, draft);
        }
      }
      this.extensionCommandCompatibilityByWorkspace.clear();
      for (const [workspaceId, records] of restoreCompatibilityByWorkspace(
        persisted.extensionCommandCompatibilityByWorkspace,
      )) {
        this.extensionCommandCompatibilityByWorkspace.set(workspaceId, records);
      }
      const initialWorkspacePaths = this.initialWorkspacePaths.map((path) => path.trim()).filter(Boolean);
      const listWorkspacesStartedAt = Date.now();
      const knownWorkspaces = await this.driver.listWorkspaces();
      logSlowStartupStep("list workspaces", listWorkspacesStartedAt);
      const workspacesToSync = new Map<string, string | undefined>();

      for (const workspacePath of initialWorkspacePaths) {
        workspacesToSync.set(workspacePath, undefined);
      }

      for (const ws of knownWorkspaces.workspaces) {
        workspacesToSync.set(ws.path, ws.displayName);
      }

      const syncWorkspacesStartedAt = Date.now();
      await Promise.all(
        [...workspacesToSync.entries()].map(([workspacePath, displayName]) =>
          this.driver.syncWorkspace(workspacePath, displayName),
        ),
      );
      logSlowStartupStep("sync workspaces", syncWorkspacesStartedAt);

      const refreshStartedAt = Date.now();
      await this.refreshState({
        selectedWorkspaceId: persisted.selectedWorkspaceId,
        selectedSessionId: persisted.selectedSessionId,
        composerDraft: persisted.composerDraft,
        clearLastError: true,
        refreshWorktrees: false,
        hydrateSelectedSession: false,
        hydrateRuntime: false,
      });
      logSlowStartupStep("initial refresh state", refreshStartedAt);
      this.startSelectedSessionHydration(this.selectedSessionRef());
      this.startStartupWorktreeRefresh();
      logSlowStartupStep("store initialize", initializeStartedAt, 200);
    } catch (error) {
      this.state = {
        ...createEmptyDesktopAppState(),
        lastError: error instanceof Error ? error.message : String(error),
        revision: 1,
      };
      await this.persistUiState();
      this.emit();
    }
  }

  private async migrateLegacyPersistence(persisted: LegacyPersistedUiState): Promise<void> {
    const transcriptEntries = Object.entries(persisted.transcripts ?? {});
    await Promise.all(
      transcriptEntries.map(async ([key, transcript]) => {
        const clonedTranscript = transcript.map((item) => cloneTranscriptMessage(item as TranscriptMessage));
        if (clonedTranscript.length > 0) {
          if (this.isPossiblyTrimmedLegacyTranscript(clonedTranscript)) {
            return;
          }
          this.sessionState.transcriptCache.set(key, clonedTranscript);
          this.sessionState.loadedTranscriptKeys.add(key);
          await this.writePersistedTranscript(key, clonedTranscript);
        }
      }),
    );

    const attachmentEntries = Object.entries(persisted.composerAttachmentsBySession ?? {});
    await Promise.all(
      attachmentEntries.map(async ([key, attachments]) => {
        const cloned = cloneComposerAttachments(attachments as readonly ComposerAttachment[]);
        if (cloned.length > 0) {
          this.sessionState.composerAttachmentsBySession.set(key, cloned);
          await this.attachmentStore.write(key, cloned);
        }
      }),
    );
  }

  async refreshState(options: RefreshStateOptions = {}): Promise<DesktopAppState> {
    this.refreshStateDepth += 1;
    try {
      const hydrateRuntime = options.hydrateRuntime !== false;
      const previousSelectedKey = this.currentSelectedSessionKey();
      const [workspacesSnapshot, sessionsSnapshot] = await Promise.all([
        this.driver.listWorkspaces(),
        this.driver.listSessions(),
      ]);
      const worktreeEntries = options.refreshWorktrees
        ? await worktree.syncAndListWorktrees(this, workspacesSnapshot.workspaces)
        : (await this.catalogStore.worktrees.listWorktrees()).worktrees;

      await this.pruneStaleSessionSubscriptions(sessionsSnapshot.sessions);
      await this.ensureSubscriptionsForSessions(sessionsSnapshot.sessions);

      const selectedWorkspaceId = resolveSelectedWorkspaceIdFromCatalog(
        options.selectedWorkspaceId ?? this.state.selectedWorkspaceId,
        workspacesSnapshot.workspaces,
      );
      const selectedSessionId = resolveSelectedSessionIdFromCatalog(
        selectedWorkspaceId,
        options.selectedSessionId ?? this.state.selectedSessionId,
        sessionsSnapshot.sessions,
      );

      if (selectedWorkspaceId && selectedSessionId && options.hydrateSelectedSession !== false) {
        const sessionRef = {
          workspaceId: selectedWorkspaceId,
          sessionId: selectedSessionId,
        };
        await this.ensureSessionReady(sessionRef);
        await this.ensureComposerAttachmentsLoaded(sessionRef);
      }

      const workspaces = buildWorkspaceRecords(
        workspacesSnapshot.workspaces,
        worktreeEntries,
        sessionsSnapshot.sessions,
        this.sessionState.transcriptCache,
        this.sessionState.runningSinceBySession,
        this.sessionState.sessionConfigBySession,
        this.sessionState.lastViewedAtBySession,
      );
      const worktreesByWorkspace = buildWorktreeRecords(workspacesSnapshot.workspaces, worktreeEntries);
      const liveWorkspaceIds = new Set(workspaces.map((w) => w.id));
      for (const wsId of this.runtimeByWorkspace.keys()) {
        if (!liveWorkspaceIds.has(wsId)) {
          this.runtimeByWorkspace.delete(wsId);
        }
      }
      for (const workspaceId of this.extensionCommandCompatibilityByWorkspace.keys()) {
        if (!liveWorkspaceIds.has(workspaceId)) {
          this.extensionCommandCompatibilityByWorkspace.delete(workspaceId);
        }
      }

      if (hydrateRuntime && selectedWorkspaceId && !this.runtimeByWorkspace.has(selectedWorkspaceId)) {
        await this.ensureRuntimeLoaded(selectedWorkspaceId, workspacesSnapshot.workspaces);
      }
      for (const runtime of this.runtimeByWorkspace.values()) {
        pruneCompatibilityForRuntimeSnapshot(this.extensionCommandCompatibilityByWorkspace, runtime);
      }
      const liveGlobalModelSettings = hydrateRuntime
        ? await this.loadLiveGlobalModelSettings(
            workspacesSnapshot.workspaces,
            selectedWorkspaceId || workspacesSnapshot.workspaces[0]?.workspaceId,
          )
        : this.state.globalModelSettings;
      const globalModelSettings =
        this.state.modelSettingsScopeMode === "per-repo" && hasStoredModelSettings(this.state.globalModelSettings)
          ? this.state.globalModelSettings
          : liveGlobalModelSettings;
      if (
        this.state.modelSettingsScopeMode === "per-repo" &&
        hasStoredModelSettings(globalModelSettings) &&
        !modelSettingsEqual(globalModelSettings, liveGlobalModelSettings)
      ) {
        await this.restoreGlobalModelSettings(globalModelSettings, workspacesSnapshot.workspaces, selectedWorkspaceId);
      }
      const scopedModelSettingsByWorkspace =
        hydrateRuntime && this.state.modelSettingsScopeMode === "per-repo"
          ? await this.loadScopedModelSettingsByWorkspace(workspaces, workspacesSnapshot.workspaces, globalModelSettings)
          : undefined;
      const runtimeByWorkspace = this.serializeEffectiveRuntimeState(workspaces, scopedModelSettingsByWorkspace);

      const activeView = options.activeView ?? this.state.activeView;
      const composerDraftSync = this.resolveComposerDraftSync(selectedWorkspaceId, selectedSessionId, options);
      this.state = {
        ...this.state,
        workspaces,
        worktreesByWorkspace,
        selectedWorkspaceId,
        selectedSessionId,
        activeView,
        runtimeByWorkspace,
        sessionCommandsBySession: mapToRecord(this.sessionState.sessionCommandsBySession),
        sessionExtensionUiBySession: this.serializeSessionExtensionUiState(),
        extensionCommandCompatibilityByWorkspace: serializeCompatibilityByWorkspace(this.extensionCommandCompatibilityByWorkspace),
        lastViewedAtBySession: mapToRecord(this.sessionState.lastViewedAtBySession),
        workspaceOrder: this.state.workspaceOrder,
        modelSettingsScopeMode: this.state.modelSettingsScopeMode,
        globalModelSettings,
        composerDraft: this.resolveComposerDraft(selectedWorkspaceId, selectedSessionId, options.composerDraft),
        composerDraftSyncSource: composerDraftSync.source,
        composerDraftSyncNonce: composerDraftSync.nonce,
        composerAttachments: this.resolveComposerAttachments(selectedWorkspaceId, selectedSessionId),
        queuedComposerMessages: this.resolveQueuedComposerMessages(selectedWorkspaceId, selectedSessionId),
        editingQueuedMessageId: this.resolveEditingQueuedMessageId(selectedWorkspaceId, selectedSessionId),
        lastError: this.resolveSelectedSessionError(selectedWorkspaceId, selectedSessionId, options.clearLastError),
        revision: this.state.revision + 1,
      };

      if (options.markSelectedSessionViewed ?? true) {
        this.markSelectedSessionViewedIfVisible();
      }

      await this.persistUiState();
      const snapshot = this.emit();
      if (this.currentSelectedSessionKey() !== previousSelectedKey) {
        this.publishSelectedTranscript();
      }
      return snapshot;
    } finally {
      this.refreshStateDepth = Math.max(0, this.refreshStateDepth - 1);
    }
  }

  private async pruneStaleSessionSubscriptions(sessions: readonly SessionCatalogEntry[]): Promise<void> {
    const activeKeys = new Set(sessions.map((session) => sessionKey(session.sessionRef)));
    this.sessionState.prune(activeKeys);
  }

  private async ensureSubscriptionsForSessions(sessions: readonly SessionCatalogEntry[]): Promise<void> {
    for (const session of sessions) {
      if (session.status !== "running") {
        continue;
      }
      await this.ensureSessionSubscription(session.sessionRef);
    }
  }

  async ensureSessionReady(sessionRef: SessionRef): Promise<SessionSnapshot | undefined> {
    await this.ensureTranscriptLoaded(sessionRef);
    let snapshot: SessionSnapshot | undefined;
    if (!this.sessionState.sessionSubscriptions.has(sessionKey(sessionRef))) {
      snapshot = await this.driver.openSession(sessionRef);
      this.updateSessionConfig(sessionRef, snapshot.config);
    }
    await this.ensureSessionSubscribed(sessionRef);
    await this.refreshSessionCommands(sessionRef);
    return snapshot;
  }

  async ensureSessionSubscription(sessionRef: SessionRef): Promise<void> {
    if (!this.sessionState.sessionSubscriptions.has(sessionKey(sessionRef))) {
      const snapshot = await this.driver.openSession(sessionRef);
      this.updateSessionConfig(sessionRef, snapshot.config);
      this.updateQueuedComposerMessages(sessionRef, snapshot.queuedMessages);
    }
    await this.ensureSessionSubscribed(sessionRef);
  }

  private async ensureTranscriptLoaded(sessionRef: SessionRef): Promise<void> {
    const key = sessionKey(sessionRef);
    if (this.sessionState.loadedTranscriptKeys.has(key)) {
      return;
    }

    const cachedTranscript = await this.readPersistedTranscript(key);
    const transcript = cachedTranscript
      ? await this.resolveLoadedTranscript(sessionRef, cachedTranscript)
      : await this.driver.getTranscript(sessionRef);

    if (!cachedTranscript || cachedTranscript.format === "legacy") {
      await this.writePersistedTranscript(key, transcript);
    }

    this.sessionState.loadedTranscriptKeys.add(key);
    this.sessionState.transcriptCache.set(key, transcript);
  }

  async reloadTranscriptFromDriver(sessionRef: SessionRef): Promise<void> {
    const key = sessionKey(sessionRef);
    const transcript = await this.driver.getTranscript(sessionRef);
    this.sessionState.loadedTranscriptKeys.add(key);
    this.sessionState.transcriptCache.set(key, transcript);
    void this.writePersistedTranscript(key, transcript);
    this.publishSelectedTranscriptFor(sessionRef);
  }

  private async ensureComposerAttachmentsLoaded(sessionRef: SessionRef): Promise<void> {
    const key = sessionKey(sessionRef);
    if (this.sessionState.composerAttachmentsBySession.has(key)) {
      return;
    }

    const attachments = await this.attachmentStore.read(key);
    if (attachments?.length) {
      this.sessionState.composerAttachmentsBySession.set(key, cloneComposerAttachments(attachments));
    }
  }

  private async ensureRuntimeLoaded(
    workspaceId: string,
    workspaces?: readonly { workspaceId: string; path: string; displayName: string }[],
  ): Promise<void> {
    if (this.runtimeByWorkspace.has(workspaceId)) {
      return;
    }

    const ws =
      this.workspaceRefFromState(workspaceId) ??
      workspaces?.find((entry) => entry.workspaceId === workspaceId);
    if (!ws) {
      return;
    }

    const snapshot = await this.driver.runtimeSupervisor.getRuntimeSnapshot({
      workspaceId: ws.workspaceId,
      path: ws.path,
      displayName: ws.displayName,
    });
    this.runtimeByWorkspace.set(workspaceId, snapshot);
  }

  async ensureSessionSubscribed(sessionRef: SessionRef): Promise<void> {
    const key = sessionKey(sessionRef);
    if (this.sessionState.sessionSubscriptions.has(key)) {
      return;
    }

    const unsubscribe = this.driver.subscribe(sessionRef, (event) => {
      void this.handleSessionEvent(event, key);
    });
    this.sessionState.sessionSubscriptions.set(key, unsubscribe);
  }

  private migrateSessionSubscriptionKey(sourceKey: string, targetKey: string): void {
    if (sourceKey === targetKey) {
      return;
    }

    const unsubscribe = this.sessionState.sessionSubscriptions.get(sourceKey);
    if (!unsubscribe) {
      return;
    }

    if (this.sessionState.sessionSubscriptions.has(targetKey)) {
      unsubscribe();
      this.sessionState.sessionSubscriptions.delete(sourceKey);
      return;
    }

    this.sessionState.sessionSubscriptions.delete(sourceKey);
    this.sessionState.sessionSubscriptions.set(targetKey, unsubscribe);
  }

  async cancelPendingDialogsForSession(sessionRef: SessionRef): Promise<void> {
    const key = sessionKey(sessionRef);
    const uiState = this.sessionState.extensionUiBySession.get(key);
    if (!uiState || uiState.pendingDialogs.length === 0) {
      return;
    }

    const pendingDialogs = [...uiState.pendingDialogs];
    uiState.pendingDialogs = [];
    await Promise.all(
      pendingDialogs.map((dialog) =>
        this.driver.respondToHostUiRequest(sessionRef, {
          requestId: dialog.requestId,
          cancelled: true,
        } satisfies HostUiResponse),
      ),
    );
  }

  async respondToHostUiRequest(
    sessionRef: SessionRef,
    response: HostUiResponse,
  ): Promise<DesktopAppState> {
    const key = sessionKey(sessionRef);
    const uiState = this.sessionState.extensionUiBySession.get(key);
    if (uiState) {
      uiState.pendingDialogs = uiState.pendingDialogs.filter((dialog) => dialog.requestId !== response.requestId);
    }

    return this.withErrorHandling(async () => {
      await this.driver.respondToHostUiRequest(sessionRef, response);
      return this.refreshState({ clearLastError: true });
    });
  }

  private async refreshSessionCommands(sessionRef: SessionRef): Promise<void> {
    const key = sessionKey(sessionRef);
    const commands = await this.driver.getSessionCommands(sessionRef);
    this.sessionState.sessionCommandsBySession.set(key, [...commands]);
  }

  async refreshSessionCommandsFor(sessionRef: SessionRef): Promise<void> {
    await this.refreshSessionCommands(sessionRef);
  }

  getLearnedRuntimeCommandCompatibility(
    workspaceId: string,
    command: RuntimeCommandRecord,
  ): ExtensionCommandCompatibilityRecord | undefined {
    return getLearnedCommandCompatibility(this.extensionCommandCompatibilityByWorkspace, workspaceId, command);
  }

  beginRuntimeCommandExecution(sessionRef: SessionRef, command: RuntimeCommandRecord): void {
    this.pendingRuntimeCommandsBySession.set(sessionKey(sessionRef), { command });
  }

  finishRuntimeCommandExecution(
    sessionRef: SessionRef,
    timestamp = new Date().toISOString(),
  ): PendingRuntimeCommandExecution | undefined {
    const key = sessionKey(sessionRef);
    const pending = this.pendingRuntimeCommandsBySession.get(key);
    if (!pending) {
      return undefined;
    }

    this.pendingRuntimeCommandsBySession.delete(key);
    if (!pending.blockedMessage) {
      recordLearnedCommandCompatibility(this.extensionCommandCompatibilityByWorkspace, sessionRef.workspaceId, {
        commandName: pending.command.name,
        extensionPath: pending.command.sourceInfo.path,
        status: "supported",
        message: "Observed working in pi-gui.",
        capability: "gui-safe",
        updatedAt: timestamp,
      });
    }

    return pending;
  }

  clearExtensionUiForSession(sessionRef: SessionRef): void {
    const key = sessionKey(sessionRef);
    if (!this.sessionState.extensionUiBySession.has(key)) {
      return;
    }

    this.sessionState.extensionUiBySession.delete(key);
    this.state = this.syncDerivedSessionState(this.state, sessionRef);
  }

  async refreshSessionCommandsForWorkspace(workspaceId: string): Promise<void> {
    await runWithConcurrency(this.sessionRefsForWorkspace(workspaceId), 4, (sessionRef) => this.refreshSessionCommands(sessionRef));
  }

  async reloadSessionsForWorkspace(workspaceId: string): Promise<void> {
    await runWithConcurrency(this.sessionRefsForWorkspace(workspaceId), 4, (sessionRef) => this.driver.reloadSession(sessionRef));
  }

  clearExtensionUiForWorkspace(workspaceId: string): void {
    for (const sessionRef of this.sessionRefsForWorkspace(workspaceId)) {
      this.clearExtensionUiForSession(sessionRef);
    }
  }

  private reportExtensionCompatibilityIssue(
    sessionRef: SessionRef,
    issue: Extract<SessionDriverEvent, { type: "extensionCompatibilityIssue" }>["issue"],
    timestamp: string,
  ): void {
    const key = sessionKey(sessionRef);
    const pending = this.pendingRuntimeCommandsBySession.get(key);
    if (pending) {
      const message = `/${pending.command.name} requires terminal-only ${formatCapabilityLabel(issue.capability)} and is not supported in pi-gui yet. Use pi in the terminal for this command.`;
      pending.blockedMessage = message;
      recordLearnedCommandCompatibility(this.extensionCommandCompatibilityByWorkspace, sessionRef.workspaceId, {
        commandName: pending.command.name,
        extensionPath: pending.command.sourceInfo.path,
        status: "terminal-only",
        message,
        capability: issue.capability,
        updatedAt: timestamp,
      });
      this.sessionState.sessionErrorsBySession.set(key, message);
      return;
    }

    const fingerprint = `${issue.extensionPath ?? "<unknown>"}:${issue.eventName ?? "<unknown>"}:${issue.capability}`;
    const seen = this.reportedCompatibilityIssuesBySession.get(key) ?? new Set<string>();
    if (seen.has(fingerprint)) {
      return;
    }

    seen.add(fingerprint);
    this.reportedCompatibilityIssuesBySession.set(key, seen);
    this.sessionState.sessionErrorsBySession.set(key, issue.message);
  }

  private sessionRefsForWorkspace(workspaceId: string): SessionRef[] {
    const workspace = this.state.workspaces.find((entry) => entry.id === workspaceId);
    if (!workspace) {
      return [];
    }

    return workspace.sessions
      .map((session) => ({
        workspaceId,
        sessionId: session.id,
      }))
      .filter((sessionRef) => {
        const key = sessionKey(sessionRef);
        return (
          (this.state.selectedWorkspaceId === workspaceId && this.state.selectedSessionId === sessionRef.sessionId) ||
          this.sessionState.sessionCommandsBySession.has(key) ||
          this.sessionState.sessionSubscriptions.has(key)
        );
      });
  }

  private getOrCreateExtensionUiState(sessionRef: SessionRef) {
    const key = sessionKey(sessionRef);
    const existing = this.sessionState.extensionUiBySession.get(key);
    if (existing) {
      return existing;
    }

    const created = createEmptyExtensionUiState();
    this.sessionState.extensionUiBySession.set(key, created);
    return created;
  }

  private applyHostUiRequest(event: Extract<SessionDriverEvent, { type: "hostUiRequest" }>): void {
    const key = sessionKey(event.sessionRef);
    if (event.request.kind === "reset") {
      this.sessionState.extensionUiBySession.delete(key);
      return;
    }

    const uiState = this.getOrCreateExtensionUiState(event.sessionRef);
    applyHostUiRequestToExtensionUiState(uiState, event.request);

    switch (event.request.kind) {
      case "editorText":
        this.sessionState.composerDraftsBySession.set(key, event.request.text);
        if (
          this.state.selectedWorkspaceId === event.sessionRef.workspaceId &&
          this.state.selectedSessionId === event.sessionRef.sessionId
        ) {
          this.state = {
            ...this.state,
            composerDraft: event.request.text,
            composerDraftSyncSource: "extension-editor-text",
            composerDraftSyncNonce: this.state.composerDraftSyncNonce + 1,
          };
        }
        break;
      default:
        if (isExtensionUiDialogRequest(event.request)) {
          const dialog = event.request;
          uiState.pendingDialogs = [
            ...uiState.pendingDialogs.filter((entry) => entry.requestId !== dialog.requestId),
            dialog,
          ];
        }
        break;
    }
  }

  private async handleSessionEvent(event: SessionDriverEvent, subscriptionKey = sessionKey(event.sessionRef)): Promise<void> {
    const key = sessionKey(event.sessionRef);
    if (subscriptionKey !== key) {
      this.migrateSessionSubscriptionKey(subscriptionKey, key);
    }
    const knownSession = this.sessionFromState(event.sessionRef);
    const shouldFollowSessionMutation = subscriptionKey !== key && this.currentSelectedSessionKey() === subscriptionKey;
    let refreshedFollowedSession = false;
    if (
      !knownSession &&
      (event.type === "sessionOpened" ||
        event.type === "sessionUpdated" ||
        event.type === "runCompleted" ||
        event.type === "hostUiRequest")
    ) {
      if (this.refreshStateDepth === 0) {
        await this.refreshState({
          selectedWorkspaceId:
            this.state.selectedWorkspaceId === event.sessionRef.workspaceId
              ? event.sessionRef.workspaceId
              : this.state.selectedWorkspaceId,
          selectedSessionId: shouldFollowSessionMutation ? event.sessionRef.sessionId : this.state.selectedSessionId,
          clearLastError: true,
        });
        refreshedFollowedSession = shouldFollowSessionMutation;
      }
    }

    switch (event.type) {
      case "assistantDelta": {
        const message = appendAssistantDelta(this.sessionState.transcriptCache, this.sessionState.activeAssistantMessageBySession, event.sessionRef, event.text);
        this.persistTranscriptCacheForSession(event.sessionRef);
        this.publishSelectedTranscriptDelta({
          kind: "appendAssistantText",
          workspaceId: event.sessionRef.workspaceId,
          sessionId: event.sessionRef.sessionId,
          messageId: message.id,
          createdAt: message.createdAt,
          text: event.text,
        });
        return;
      }
      case "sessionOpened":
      case "runCompleted":
        this.updateSessionConfig(event.sessionRef, event.snapshot.config);
        this.updateQueuedComposerMessages(event.sessionRef, event.snapshot.queuedMessages);
        await this.refreshSessionCommands(event.sessionRef);
        break;
      case "sessionUpdated":
        this.updateSessionConfig(event.sessionRef, event.snapshot.config);
        this.updateQueuedComposerMessages(event.sessionRef, event.snapshot.queuedMessages);
        if (event.snapshot.status !== "running") {
          await this.refreshSessionCommands(event.sessionRef);
        }
        break;
      case "runFailed":
        this.state = {
          ...this.state,
          lastError: event.error.message,
        };
        await this.refreshSessionCommands(event.sessionRef);
        break;
      case "extensionCompatibilityIssue":
        this.reportExtensionCompatibilityIssue(event.sessionRef, event.issue, event.timestamp);
        break;
      case "sessionClosed":
        this.sessionState.extensionUiBySession.delete(key);
        this.sessionState.sessionCommandsBySession.delete(key);
        this.sessionState.queuedComposerMessagesBySession.delete(key);
        this.sessionState.queuedComposerEditsBySession.delete(key);
        this.clearPendingAutoTitle(event.sessionRef);
        this.pendingRuntimeCommandsBySession.delete(key);
        this.reportedCompatibilityIssuesBySession.delete(key);
        break;
      case "toolStarted":
      case "toolUpdated":
      case "toolFinished":
        break;
      case "hostUiRequest":
        this.applyHostUiRequest(event);
        break;
      default:
        break;
    }

    if (event.type === "sessionClosed") {
      this.sessionState.sessionSubscriptions.get(key)?.();
      this.sessionState.sessionSubscriptions.delete(key);
    }

    if (event.type === "runFailed") {
      this.sessionState.sessionErrorsBySession.set(key, event.error.message);
    } else if (event.type === "runCompleted" || event.type === "sessionClosed") {
      this.sessionState.sessionErrorsBySession.delete(key);
    }

    const changedTimelineItem = applyTimelineEvent(this.sessionState.transcriptCache, event, {
      runMetricsBySession: this.sessionState.runMetricsBySession,
      runningSinceBySession: this.sessionState.runningSinceBySession,
      activeAssistantMessageBySession: this.sessionState.activeAssistantMessageBySession,
      activeWorkingActivityBySession: this.sessionState.activeWorkingActivityBySession,
    });
    if (changedTimelineItem && (event.type === "toolStarted" || event.type === "toolUpdated" || event.type === "toolFinished")) {
      this.persistTranscriptCacheForSession(event.sessionRef);
      this.publishSelectedTranscriptDelta({
        kind: "upsertItem",
        workspaceId: event.sessionRef.workspaceId,
        sessionId: event.sessionRef.sessionId,
        item: cloneTranscriptMessage(changedTimelineItem),
      });
      return;
    }
    this.state = applySessionEventState(
      this.state,
      event,
      this.sessionState.transcriptCache,
      this.sessionState.runningSinceBySession,
      this.sessionState.lastViewedAtBySession,
    );
    this.markSessionViewedIfActivelyViewed(event.sessionRef);
    this.state = this.syncDerivedSessionState(this.state, event.sessionRef);
    if (shouldFollowSessionMutation && event.type !== "sessionClosed") {
      this.applyFastSessionSelection(event.sessionRef);
      if (!refreshedFollowedSession) {
        this.startSelectedSessionHydration(event.sessionRef);
      }
    }
    if (event.type !== "hostUiRequest") {
      this.persistTranscriptCacheForSession(event.sessionRef);
    }
    if (event.type === "runCompleted" || event.type === "runFailed" || event.type === "sessionClosed") {
      await this.persistUiState();
    } else if (event.type !== "hostUiRequest") {
      this.schedulePersistUiState();
    }
    const snapshot = this.emit();
    this.publishSelectedTranscriptFor(event.sessionRef);
    await this.emitSessionEvent(event, snapshot);
  }

  workspaceRefFromState(workspaceId: string): WorkspaceRef | undefined {
    const ws = this.state.workspaces.find((entry) => entry.id === workspaceId);
    if (!ws) {
      return undefined;
    }

    return {
      workspaceId: ws.id,
      path: ws.path,
      displayName: ws.name,
    };
  }

  resolveModelSettingsWorkspaceId(workspaceId: string): string {
    if (this.state.modelSettingsScopeMode !== "per-repo") {
      return workspaceId;
    }
    return resolveRepoWorkspaceId(this.state.workspaces, workspaceId) ?? workspaceId;
  }

  private async loadLiveGlobalModelSettings(
    workspaces: readonly { workspaceId: string; path: string; displayName: string }[],
    preferredWorkspaceId?: string,
  ): Promise<ModelSettingsSnapshot> {
    const fallbackWorkspace =
      (preferredWorkspaceId ? workspaces.find((entry) => entry.workspaceId === preferredWorkspaceId) : undefined) ?? workspaces[0];
    if (!fallbackWorkspace) {
      return this.state.globalModelSettings;
    }
    return this.driver.runtimeSupervisor.getGlobalModelSettings({
      workspaceId: fallbackWorkspace.workspaceId,
      path: fallbackWorkspace.path,
      displayName: fallbackWorkspace.displayName,
    });
  }

  async buildCreateSessionOptions(workspaceId: string): Promise<CreateSessionOptions | undefined> {
    if (this.state.modelSettingsScopeMode !== "per-repo") {
      return undefined;
    }
    const effectiveSettings = await this.loadEffectiveModelSettingsForWorkspace(workspaceId);
    if (!effectiveSettings) {
      return undefined;
    }
    return {
      ...(effectiveSettings.defaultProvider && effectiveSettings.defaultModelId
        ? { initialModel: { provider: effectiveSettings.defaultProvider, modelId: effectiveSettings.defaultModelId } }
        : {}),
      ...(effectiveSettings.defaultThinkingLevel ? { initialThinkingLevel: effectiveSettings.defaultThinkingLevel } : {}),
    };
  }

  private serializeRuntimeState(): Record<string, RuntimeSnapshot> {
    return mapToRecord(this.runtimeByWorkspace);
  }

  private async serializeRuntimeStateForCurrentWorkspaces(): Promise<Record<string, RuntimeSnapshot>> {
    const runtimeByWorkspace = this.serializeRuntimeState();
    if (this.state.modelSettingsScopeMode !== "per-repo") {
      return runtimeByWorkspace;
    }

    const workspaceRefs = this.state.workspaces.map((workspace) => ({
      workspaceId: workspace.id,
      path: workspace.path,
      displayName: workspace.name,
    }));
    const scopedModelSettingsByWorkspace = await this.loadScopedModelSettingsByWorkspace(
      this.state.workspaces,
      workspaceRefs,
      this.state.globalModelSettings,
    );
    return this.serializeEffectiveRuntimeState(this.state.workspaces, scopedModelSettingsByWorkspace);
  }

  private async loadScopedModelSettingsByWorkspace(
    workspaces: DesktopAppState["workspaces"],
    workspaceRefs: readonly { workspaceId: string; path: string; displayName: string }[],
    globalModelSettings: ModelSettingsSnapshot,
  ): Promise<Record<string, ModelSettingsSnapshot>> {
    const uniqueOwnerIds = [...new Set(workspaces.map((workspace) => resolveRepoWorkspaceId(workspaces, workspace.id) ?? workspace.id))];
    const refsByWorkspaceId = new Map(workspaceRefs.map((workspace) => [workspace.workspaceId, workspace] as const));
    const ownerSettings = await Promise.all(
      uniqueOwnerIds.map(async (workspaceId) => {
        const workspace = refsByWorkspaceId.get(workspaceId);
        if (!workspace) {
          return undefined;
        }
        return [
          workspaceId,
          mergeModelSettingsSnapshot(globalModelSettings, await readProjectModelSettingsFile(workspace.path)),
        ] as const;
      }),
    );

    return Object.fromEntries(ownerSettings.filter((entry): entry is readonly [string, ModelSettingsSnapshot] => Boolean(entry)));
  }

  private serializeEffectiveRuntimeState(
    workspaces: DesktopAppState["workspaces"],
    scopedModelSettingsByWorkspace?: Record<string, ModelSettingsSnapshot>,
  ): Record<string, RuntimeSnapshot> {
    const runtimeByWorkspace = this.serializeRuntimeState();
    if (this.state.modelSettingsScopeMode !== "per-repo") {
      return runtimeByWorkspace;
    }

    for (const workspace of workspaces) {
      const ownerWorkspaceId = resolveRepoWorkspaceId(workspaces, workspace.id);
      const workspaceRuntime = runtimeByWorkspace[workspace.id];
      const modelSettings = ownerWorkspaceId ? scopedModelSettingsByWorkspace?.[ownerWorkspaceId] : undefined;
      if (!workspaceRuntime || !modelSettings) {
        continue;
      }
      runtimeByWorkspace[workspace.id] = applyModelSettingsSnapshot(workspaceRuntime, modelSettings);
    }

    return runtimeByWorkspace;
  }

  private serializeSessionExtensionUiState() {
    return Object.fromEntries(
      [...this.sessionState.extensionUiBySession.entries()].map(([key, value]) => [key, serializeExtensionUiState(value)] as const),
    );
  }

  private syncDerivedSessionState(state: DesktopAppState, sessionRef: SessionRef): DesktopAppState {
    const key = sessionKey(sessionRef);
    const serializedExtensionUi = this.sessionState.extensionUiBySession.get(key);

    return {
      ...state,
      sessionCommandsBySession: updateRecordValue(
        state.sessionCommandsBySession,
        key,
        this.sessionState.sessionCommandsBySession.get(key),
      ),
      sessionExtensionUiBySession: updateRecordValue(
        state.sessionExtensionUiBySession,
        key,
        serializedExtensionUi ? serializeExtensionUiState(serializedExtensionUi) : undefined,
      ),
      extensionCommandCompatibilityByWorkspace: serializeCompatibilityByWorkspace(this.extensionCommandCompatibilityByWorkspace),
      lastViewedAtBySession: updateRecordValue(
        state.lastViewedAtBySession,
        key,
        this.sessionState.lastViewedAtBySession.get(key),
      ),
      queuedComposerMessages: this.resolveQueuedComposerMessages(state.selectedWorkspaceId, state.selectedSessionId),
      editingQueuedMessageId: this.resolveEditingQueuedMessageId(state.selectedWorkspaceId, state.selectedSessionId),
      lastError: this.resolveSelectedSessionError(state.selectedWorkspaceId, state.selectedSessionId, false),
    };
  }

  selectedSessionRef(): SessionRef | undefined {
    if (!this.state.selectedWorkspaceId || !this.state.selectedSessionId) {
      return undefined;
    }

    return toSessionRef({
      workspaceId: this.state.selectedWorkspaceId,
      sessionId: this.state.selectedSessionId,
    });
  }

  sessionFromState(sessionRef: SessionRef) {
    return this.state.workspaces
      .find((w) => w.id === sessionRef.workspaceId)
      ?.sessions.find((s) => s.id === sessionRef.sessionId);
  }

  private async loadEffectiveModelSettingsForWorkspace(workspaceId: string): Promise<ModelSettingsSnapshot | undefined> {
    const ownerWorkspaceId = this.resolveModelSettingsWorkspaceId(workspaceId);
    const ownerWorkspace = this.workspaceRefFromState(ownerWorkspaceId);
    if (!ownerWorkspace) {
      return undefined;
    }
    const globalModelSettings =
      this.state.modelSettingsScopeMode === "per-repo" && hasStoredModelSettings(this.state.globalModelSettings)
        ? this.state.globalModelSettings
        : await this.loadLiveGlobalModelSettings(
            this.state.workspaces.map((workspace) => ({
              workspaceId: workspace.id,
              path: workspace.path,
              displayName: workspace.name,
            })),
            ownerWorkspaceId,
          );
    return mergeModelSettingsSnapshot(globalModelSettings, await readProjectModelSettingsFile(ownerWorkspace.path));
  }

  private async restoreGlobalModelSettings(
    settings: ModelSettingsSnapshot,
    workspaces?: readonly { workspaceId: string; path: string; displayName: string }[],
    preferredWorkspaceId?: string,
  ): Promise<void> {
    if (!hasStoredModelSettings(settings)) {
      return;
    }
    const workspaceRefs =
      workspaces ??
      this.state.workspaces.map((workspace) => ({
        workspaceId: workspace.id,
        path: workspace.path,
        displayName: workspace.name,
      }));
    const fallbackWorkspace =
      (preferredWorkspaceId ? workspaceRefs.find((entry) => entry.workspaceId === preferredWorkspaceId) : undefined) ??
      workspaceRefs[0];
    if (!fallbackWorkspace) {
      return;
    }
    const workspaceRef = {
      workspaceId: fallbackWorkspace.workspaceId,
      path: fallbackWorkspace.path,
      displayName: fallbackWorkspace.displayName,
    };
    await this.driver.runtimeSupervisor.setScopedModelPatterns(workspaceRef, settings.enabledModelPatterns);
    if (settings.defaultThinkingLevel) {
      await this.driver.runtimeSupervisor.setDefaultThinkingLevel(workspaceRef, settings.defaultThinkingLevel);
    }
    if (settings.defaultProvider && settings.defaultModelId) {
      await this.driver.runtimeSupervisor.setDefaultModel(workspaceRef, {
        provider: settings.defaultProvider,
        modelId: settings.defaultModelId,
      });
    }
    if (this.runtimeByWorkspace.has(workspaceRef.workspaceId)) {
      this.runtimeByWorkspace.set(workspaceRef.workspaceId, await this.driver.runtimeSupervisor.refreshRuntime(workspaceRef));
    }
  }

  private async readUiState(): Promise<LegacyPersistedUiState> {
    return readPersistedUiState(this.uiStateFilePath);
  }

  async persistUiState(): Promise<void> {
    if (this.persistUiStateTimer) {
      clearTimeout(this.persistUiStateTimer);
      this.persistUiStateTimer = undefined;
    }
    const payload: PersistedUiState = {
      selectedWorkspaceId: this.state.selectedWorkspaceId || undefined,
      selectedSessionId: this.state.selectedSessionId || undefined,
      activeView: this.state.activeView,
      composerDraft: this.state.composerDraft || undefined,
      composerDraftsBySession: mapToRecord(this.sessionState.composerDraftsBySession),
      extensionCommandCompatibilityByWorkspace: serializeCompatibilityByWorkspace(this.extensionCommandCompatibilityByWorkspace),
      notificationPreferences: this.state.notificationPreferences,
      integratedTerminalShell: this.state.integratedTerminalShell || undefined,
      lastProjectOpenApp: this.state.lastProjectOpenApp,
      projectStartCommandsByWorkspace:
        Object.keys(this.state.projectStartCommandsByWorkspace).length > 0
          ? this.state.projectStartCommandsByWorkspace
          : undefined,
      lastViewedAtBySession: mapToRecord(this.sessionState.lastViewedAtBySession),
      workspaceOrder: this.state.workspaceOrder.length > 0 ? this.state.workspaceOrder : undefined,
      modelSettingsScopeMode: this.state.modelSettingsScopeMode,
      appGlobalModelSettings: hasStoredModelSettings(this.state.globalModelSettings) ? this.state.globalModelSettings : undefined,
      sidebarCollapsed: this.state.sidebarCollapsed || undefined,
    };

    await writePersistedUiState(this.uiStateFilePath, payload);
  }

  async persistComposerAttachments(
    key: string,
    attachments: readonly ComposerAttachment[],
  ): Promise<void> {
    await this.attachmentStore.write(key, cloneComposerAttachments(attachments));
    await this.persistUiState();
  }

  persistTranscriptCacheForSession(sessionRef: SessionRef): void {
    const key = sessionKey(sessionRef);
    const existing = this.transcriptPersistTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.transcriptPersistTimers.delete(key);
      const transcript = (this.sessionState.transcriptCache.get(key) ?? []).map(cloneTranscriptMessage);
      void this.writePersistedTranscript(key, transcript);
    }, 250);

    this.transcriptPersistTimers.set(key, timer);
  }

  private async readPersistedTranscript(
    key: string,
  ): Promise<
    | {
        readonly format: "versioned" | "legacy";
        readonly transcript: TranscriptMessage[];
      }
    | null
  > {
    const persisted = await this.transcriptStore.read(key);
    if (!persisted) {
      return null;
    }

    if (isPersistedTranscriptRecord(persisted)) {
      return {
        format: "versioned",
        transcript: persisted.transcript.map((item) => cloneTranscriptMessage(item as TranscriptMessage)),
      };
    }

    if (Array.isArray(persisted)) {
      return {
        format: "legacy",
        transcript: persisted.map((item) => cloneTranscriptMessage(item as TranscriptMessage)),
      };
    }

    return null;
  }

  private async resolveLoadedTranscript(
    sessionRef: SessionRef,
    persisted: {
      readonly format: "versioned" | "legacy";
      readonly transcript: TranscriptMessage[];
    },
  ): Promise<TranscriptMessage[]> {
    if (persisted.format !== "legacy" || !this.isPossiblyTrimmedLegacyTranscript(persisted.transcript)) {
      return persisted.transcript;
    }

    const driverTranscript = await this.driver.getTranscript(sessionRef);
    return shouldReplaceLegacyTranscript(persisted.transcript, driverTranscript) ? driverTranscript : persisted.transcript;
  }

  private isPossiblyTrimmedLegacyTranscript(transcript: readonly TranscriptMessage[]): boolean {
    return transcript.length === LEGACY_TRANSCRIPT_HISTORY_LIMIT;
  }

  private async writePersistedTranscript(key: string, transcript: readonly TranscriptMessage[]): Promise<void> {
    await this.transcriptStore.write(key, {
      version: 1,
      transcript: transcript.map(cloneTranscriptMessage),
    });
  }

  schedulePersistUiState(): void {
    if (this.persistUiStateTimer) {
      clearTimeout(this.persistUiStateTimer);
    }

    this.persistUiStateTimer = setTimeout(() => {
      this.persistUiStateTimer = undefined;
      void this.persistUiState();
    }, 250);
  }

  private currentSelectedSessionKey(): string {
    return this.state.selectedWorkspaceId && this.state.selectedSessionId
      ? sessionKey({
          workspaceId: this.state.selectedWorkspaceId,
          sessionId: this.state.selectedSessionId,
        })
      : "";
  }

  private isSelectedSession(sessionRef: SessionRef): boolean {
    const selected = this.selectedSessionRef();
    return Boolean(
      selected &&
      selected.workspaceId === sessionRef.workspaceId &&
      selected.sessionId === sessionRef.sessionId,
    );
  }

  private buildSelectedTranscriptRecord(sessionRef: SessionRef): SelectedTranscriptRecord {
    return {
      workspaceId: sessionRef.workspaceId,
      sessionId: sessionRef.sessionId,
      transcript: (this.sessionState.transcriptCache.get(sessionKey(sessionRef)) ?? []).map(cloneTranscriptMessage),
    };
  }

  emit(): DesktopAppState {
    const snapshot = structuredClone(this.state);
    for (const listener of this.listeners) {
      listener(snapshot);
    }
    return snapshot;
  }

  publishSelectedTranscript(): void {
    const sessionRef = this.selectedSessionRef();
    const payload = sessionRef ? this.buildSelectedTranscriptRecord(sessionRef) : null;
    for (const listener of this.selectedTranscriptListeners) {
      listener(payload);
    }
  }

  publishSelectedTranscriptFor(sessionRef: SessionRef): void {
    if (!this.isSelectedSession(sessionRef)) {
      return;
    }
    this.publishSelectedTranscript();
  }

  private publishSelectedTranscriptDelta(payload: SelectedTranscriptDelta): void {
    if (!this.isSelectedSession(payload)) return;
    for (const listener of this.selectedTranscriptDeltaListeners) listener(payload);
  }

  handleWindowActivation(): void {
    if (!this.markSelectedSessionViewedIfVisible()) {
      return;
    }

    this.schedulePersistUiState();
    this.emit();
  }

  private async emitSessionEvent(event: SessionDriverEvent, snapshot: DesktopAppState): Promise<void> {
    for (const listener of this.sessionEventListeners) {
      await listener(event, snapshot);
    }
  }

  async withError(error: unknown): Promise<DesktopAppState> {
    const message = error instanceof Error ? error.message : String(error);
    const sessionRef = this.selectedSessionRef();
    if (sessionRef) {
      this.sessionState.sessionErrorsBySession.set(sessionKey(sessionRef), message);
    }
    this.state = {
      ...this.state,
      lastError: message,
      revision: this.state.revision + 1,
    };
    await this.persistUiState();
    return this.emit();
  }

  async withErrorHandling(fn: () => Promise<DesktopAppState>): Promise<DesktopAppState> {
    try {
      return await fn();
    } catch (error) {
      return this.withError(error);
    }
  }

  private applyFastSessionSelection(sessionRef: SessionRef): DesktopAppState {
    this.state = {
      ...this.state,
      selectedWorkspaceId: sessionRef.workspaceId,
      selectedSessionId: sessionRef.sessionId,
      activeView: "threads",
      composerDraft: this.resolveComposerDraft(sessionRef.workspaceId, sessionRef.sessionId),
      composerDraftSyncSource: "selection",
      composerDraftSyncNonce: this.state.composerDraftSyncNonce + 1,
      composerAttachments: this.resolveComposerAttachments(sessionRef.workspaceId, sessionRef.sessionId),
      lastError: undefined,
      revision: this.state.revision + 1,
    };
    this.markSessionViewed(sessionRef);
    this.schedulePersistUiState();
    const snapshot = this.emit();
    if (this.sessionState.loadedTranscriptKeys.has(sessionKey(sessionRef))) {
      this.publishSelectedTranscript();
    }
    return snapshot;
  }

  private async hydrateSelectedSessionAfterSelection(sessionRef: SessionRef, selectionEpoch: number): Promise<void> {
    const runtimeMissing = !this.runtimeByWorkspace.has(sessionRef.workspaceId);
    const [snapshot] = await Promise.all([
      this.ensureSessionReady(sessionRef),
      this.ensureComposerAttachmentsLoaded(sessionRef),
      runtimeMissing ? this.ensureRuntimeLoaded(sessionRef.workspaceId) : Promise.resolve(),
    ]);

    if (!this.isCurrentSelectionEpoch(sessionRef, selectionEpoch)) {
      return;
    }

    const runtimeByWorkspace = runtimeMissing ? await this.serializeRuntimeStateForCurrentWorkspaces() : undefined;
    if (!this.isCurrentSelectionEpoch(sessionRef, selectionEpoch)) {
      return;
    }

    this.clearSessionError(sessionRef);
    this.state = this.syncSelectedSessionHydrationState(this.state, sessionRef, snapshot, runtimeByWorkspace);
    this.markSessionViewed(sessionRef);
    this.schedulePersistUiState();
    this.emit();
    this.publishSelectedTranscriptFor(sessionRef);
  }

  private startSelectedSessionHydration(sessionRef: SessionRef | undefined): void {
    if (!sessionRef) {
      return;
    }

    const selectionEpoch = ++this.selectionEpoch;
    void this.hydrateSelectedSessionAfterSelection(sessionRef, selectionEpoch).catch((error: unknown) => {
      void this.handleSelectedSessionHydrationError(sessionRef, selectionEpoch, error);
    });
  }

  private startStartupWorktreeRefresh(): void {
    void this.refreshState({
      clearLastError: true,
      refreshWorktrees: true,
      hydrateSelectedSession: false,
      hydrateRuntime: false,
      markSelectedSessionViewed: false,
    }).catch((error: unknown) => {
      console.warn(`[pi-gui] Startup worktree refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private async handleSelectedSessionHydrationError(
    sessionRef: SessionRef,
    selectionEpoch: number,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.sessionState.sessionErrorsBySession.set(sessionKey(sessionRef), message);
    if (this.isCurrentSelectionEpoch(sessionRef, selectionEpoch)) {
      await this.withError(error);
      return;
    }

    this.schedulePersistUiState();
  }

  private isCurrentSelectionEpoch(sessionRef: SessionRef, selectionEpoch: number): boolean {
    return (
      selectionEpoch === this.selectionEpoch &&
      this.state.selectedWorkspaceId === sessionRef.workspaceId &&
      this.state.selectedSessionId === sessionRef.sessionId
    );
  }

  private markSelectedSessionViewedIfVisible(): boolean {
    if (this.state.activeView !== "threads" || !this.state.selectedWorkspaceId || !this.state.selectedSessionId) {
      return false;
    }

    const sessionRef = {
      workspaceId: this.state.selectedWorkspaceId,
      sessionId: this.state.selectedSessionId,
    } satisfies SessionRef;
    if (!isSessionActivelyViewed(this.state, sessionRef, this.getWindow())) {
      return false;
    }

    return this.markSessionViewed(sessionRef);
  }

  private markSessionViewedIfActivelyViewed(sessionRef: SessionRef): boolean {
    const active = isSessionActivelyViewed(this.state, sessionRef, this.getWindow());
    if (!active) {
      return false;
    }

    return this.markSessionViewed(sessionRef);
  }

  private markSessionViewed(sessionRef: SessionRef, fallbackViewedAt = new Date().toISOString()): boolean {
    const key = sessionKey(sessionRef);
    const viewedAt = this.resolveViewedAt(sessionRef, fallbackViewedAt);
    const current = this.sessionState.lastViewedAtBySession.get(key);
    if (current && current >= viewedAt) {
      return false;
    }

    this.sessionState.lastViewedAtBySession.set(key, viewedAt);
    this.state = {
      ...this.state,
      workspaces: this.state.workspaces.map((w) =>
        w.id === sessionRef.workspaceId
          ? {
              ...w,
              sessions: w.sessions.map((s) =>
                s.id === sessionRef.sessionId
                  ? {
                      ...s,
                      lastViewedAt: viewedAt,
                      hasUnseenUpdate: false,
                    }
                  : s,
              ),
            }
          : w,
      ),
      lastViewedAtBySession: mapToRecord(this.sessionState.lastViewedAtBySession),
    };
    return true;
  }

  private resolveViewedAt(sessionRef: SessionRef, fallbackViewedAt: string): string {
    const session = this.findSessionRecord(sessionRef);
    if (!session) {
      return fallbackViewedAt;
    }

    const activityAt = latestSessionActivityAt(
      session.updatedAt,
      this.sessionState.transcriptCache.get(sessionKey(sessionRef)) ?? [],
    );
    return activityAt > fallbackViewedAt ? activityAt : fallbackViewedAt;
  }

  private findSessionRecord(sessionRef: SessionRef) {
    return this.state.workspaces
      .find((workspace) => workspace.id === sessionRef.workspaceId)
      ?.sessions.find((session) => session.id === sessionRef.sessionId);
  }

  private clearSessionError(sessionRef: SessionRef): void {
    this.sessionState.sessionErrorsBySession.delete(sessionKey(sessionRef));
  }

  private resolveComposerDraft(
    selectedWorkspaceId: string,
    selectedSessionId: string,
    explicitDraft?: string,
  ): string {
    if (explicitDraft !== undefined) {
      if (selectedWorkspaceId && selectedSessionId) {
        const key = sessionKey({ workspaceId: selectedWorkspaceId, sessionId: selectedSessionId });
        if (explicitDraft) {
          this.sessionState.composerDraftsBySession.set(key, explicitDraft);
        } else {
          this.sessionState.composerDraftsBySession.delete(key);
        }
      }
      return explicitDraft;
    }

    if (!selectedWorkspaceId || !selectedSessionId) {
      return "";
    }

    return this.sessionState.composerDraftsBySession.get(sessionKey({ workspaceId: selectedWorkspaceId, sessionId: selectedSessionId })) ?? "";
  }

  private resolveComposerDraftSync(
    selectedWorkspaceId: string,
    selectedSessionId: string,
    options: RefreshStateOptions,
  ): {
    readonly source: ComposerDraftSyncSource;
    readonly nonce: number;
  } {
    if (options.composerDraftSyncSource) {
      return {
        source: options.composerDraftSyncSource,
        nonce: this.state.composerDraftSyncNonce + 1,
      };
    }

    if (
      selectedWorkspaceId !== this.state.selectedWorkspaceId ||
      selectedSessionId !== this.state.selectedSessionId
    ) {
      return {
        source: "selection",
        nonce: this.state.composerDraftSyncNonce + 1,
      };
    }

    return {
      source: this.state.composerDraftSyncSource,
      nonce: this.state.composerDraftSyncNonce,
    };
  }

  private resolveComposerAttachments(
    selectedWorkspaceId: string,
    selectedSessionId: string,
  ): readonly ComposerAttachment[] {
    if (!selectedWorkspaceId || !selectedSessionId) {
      return [];
    }

    return this.sessionState.composerAttachmentsBySession.get(
      sessionKey({ workspaceId: selectedWorkspaceId, sessionId: selectedSessionId }),
    )?.map(cloneComposerAttachment) ?? [];
  }

  private resolveQueuedComposerMessages(
    selectedWorkspaceId: string,
    selectedSessionId: string,
  ): readonly QueuedComposerMessage[] {
    if (!selectedWorkspaceId || !selectedSessionId) {
      return [];
    }

    return this.sessionState.queuedComposerMessagesBySession.get(
      sessionKey({ workspaceId: selectedWorkspaceId, sessionId: selectedSessionId }),
    )?.filter((message) => message.mode === "followUp")
      .map((message) => ({
        ...message,
        attachments: cloneComposerAttachments(message.attachments),
      })) ?? [];
  }

  private resolveEditingQueuedMessageId(
    selectedWorkspaceId: string,
    selectedSessionId: string,
  ): string | undefined {
    if (!selectedWorkspaceId || !selectedSessionId) {
      return undefined;
    }

    return this.sessionState.queuedComposerEditsBySession.get(
      sessionKey({ workspaceId: selectedWorkspaceId, sessionId: selectedSessionId }),
    )?.messageId;
  }

  private resolveSelectedSessionError(
    selectedWorkspaceId: string,
    selectedSessionId: string,
    clearLastError?: boolean,
  ): string | undefined {
    if (!selectedWorkspaceId || !selectedSessionId) {
      return undefined;
    }

    const key = sessionKey({ workspaceId: selectedWorkspaceId, sessionId: selectedSessionId });
    if (clearLastError) {
      this.sessionState.sessionErrorsBySession.delete(key);
      return undefined;
    }

    return this.sessionState.sessionErrorsBySession.get(key);
  }

  updateSessionConfig(sessionRef: SessionRef, config: SessionConfig | undefined): void {
    const key = sessionKey(sessionRef);
    if (config && Object.keys(config).length > 0) {
      this.sessionState.sessionConfigBySession.set(key, config);
    } else {
      this.sessionState.sessionConfigBySession.delete(key);
    }
  }

  updateQueuedComposerMessages(sessionRef: SessionRef, queuedMessages: readonly SessionQueuedMessage[] | undefined): void {
    const key = sessionKey(sessionRef);
    const next = mergeQueuedComposerMessages(this.sessionState.queuedComposerMessagesBySession.get(key), queuedMessages);
    if (next.length > 0) {
      this.sessionState.queuedComposerMessagesBySession.set(key, next);
    } else {
      this.sessionState.queuedComposerMessagesBySession.delete(key);
    }

    const editState = this.sessionState.queuedComposerEditsBySession.get(key);
    if (editState && !next.some((message) => message.id === editState.messageId)) {
      this.sessionState.queuedComposerEditsBySession.delete(key);
    }
  }

  getQueuedComposerMessages(sessionRef: SessionRef): readonly QueuedComposerMessage[] {
    return this.sessionState.queuedComposerMessagesBySession.get(sessionKey(sessionRef)) ?? [];
  }

  setQueuedComposerEditState(sessionRef: SessionRef, editState: QueuedComposerEditState | undefined): void {
    const key = sessionKey(sessionRef);
    if (editState) {
      this.sessionState.queuedComposerEditsBySession.set(key, editState);
    } else {
      this.sessionState.queuedComposerEditsBySession.delete(key);
    }
  }

  getQueuedComposerEditState(sessionRef: SessionRef): QueuedComposerEditState | undefined {
    return this.sessionState.queuedComposerEditsBySession.get(sessionKey(sessionRef));
  }

  private syncSelectedSessionHydrationState(
    state: DesktopAppState,
    sessionRef: SessionRef,
    snapshot?: SessionSnapshot,
    runtimeByWorkspace?: Record<string, RuntimeSnapshot>,
  ): DesktopAppState {
    const key = sessionKey(sessionRef);
    const transcript = (this.sessionState.transcriptCache.get(key) ?? []).map(cloneTranscriptMessage);
    const preview = previewFromTranscript(transcript);
    const lastViewedAt = this.sessionState.lastViewedAtBySession.get(key);
    const nextState = {
      ...state,
      ...(runtimeByWorkspace ? { runtimeByWorkspace } : {}),
      workspaces: state.workspaces.map((workspace) =>
        workspace.id === sessionRef.workspaceId
          ? {
              ...workspace,
              sessions: workspace.sessions.map((session) => {
                if (session.id !== sessionRef.sessionId) {
                  return session;
                }

                return updateSessionRecord(session, {
                  snapshot:
                    snapshot || this.sessionState.sessionConfigBySession.has(key)
                      ? {
                          ...snapshot,
                          config: this.sessionState.sessionConfigBySession.get(key) ?? snapshot?.config,
                        }
                      : undefined,
                  transcript,
                  preview,
                  runningSince: this.sessionState.runningSinceBySession.get(key),
                  lastViewedAt,
                });
              }),
            }
          : workspace,
      ),
      composerAttachments: this.resolveComposerAttachments(state.selectedWorkspaceId, state.selectedSessionId),
      lastError: undefined,
      revision: state.revision + 1,
    };

    return this.syncDerivedSessionState(nextState, sessionRef);
  }
  setPendingAutoTitle(sessionRef: SessionRef, pending: import("./session-state-map").PendingAutoTitle): void {
    this.clearPendingAutoTitle(sessionRef);
    this.sessionState.pendingAutoTitleBySession.set(sessionKey(sessionRef), pending);
  }

  getPendingAutoTitle(sessionRef: SessionRef): import("./session-state-map").PendingAutoTitle | undefined {
    return this.sessionState.pendingAutoTitleBySession.get(sessionKey(sessionRef));
  }

  clearPendingAutoTitle(sessionRef: SessionRef): void {
    const key = sessionKey(sessionRef);
    const pendingAutoTitle = this.sessionState.pendingAutoTitleBySession.get(key);
    if (!pendingAutoTitle) {
      return;
    }
    this.sessionState.pendingAutoTitleBySession.delete(key);
    pendingAutoTitle.cancel();
  }
}

/* ── Module-private free functions ───────────────────────── */

function updateRecordValue<T>(
  record: Readonly<Record<string, T>>,
  key: string,
  value: T | undefined,
): Readonly<Record<string, T>> {
  if (value === undefined) {
    if (!(key in record)) {
      return record;
    }

    const { [key]: _removed, ...rest } = record;
    return rest;
  }

  if (record[key] === value) {
    return record;
  }

  return {
    ...record,
    [key]: value,
  };
}


async function runWithConcurrency<T>(items: readonly T[], limit: number, action: (item: T) => Promise<unknown>): Promise<void> {
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      if (item !== undefined) await action(item);
    }
  }));
}

function formatCapabilityLabel(capability: string): string {
  switch (capability) {
    case "custom":
      return "custom UI";
    case "onTerminalInput":
      return "terminal input";
    case "setEditorComponent":
      return "custom editor UI";
    case "setFooter":
      return "footer UI";
    case "setHeader":
      return "header UI";
    default:
      return capability.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  }
}

function resolveSelectedWorkspaceIdFromCatalog(
  preferredWorkspaceId: string,
  workspaces: readonly { workspaceId: string }[],
): string {
  if (preferredWorkspaceId && workspaces.some((w) => w.workspaceId === preferredWorkspaceId)) {
    return preferredWorkspaceId;
  }
  return workspaces[0]?.workspaceId ?? "";
}

function shouldReplaceLegacyTranscript(
  legacyTranscript: readonly TranscriptMessage[],
  driverTranscript: readonly TranscriptMessageRow[],
): boolean {
  if (driverTranscript.length === 0) {
    return false;
  }

  const legacyMessages = legacyTranscript.filter(isTranscriptMessageRow);
  if (driverTranscript.length > legacyMessages.length) {
    return true;
  }
  if (driverTranscript.length < legacyMessages.length) {
    return false;
  }

  return !sameTranscriptMessage(legacyMessages[0], driverTranscript[0]) ||
    !sameTranscriptMessage(legacyMessages.at(-1), driverTranscript.at(-1));
}

function isTranscriptMessageRow(item: TranscriptMessage): item is TranscriptMessageRow {
  return item.kind === "message";
}

function sameTranscriptMessage(
  left: TranscriptMessageRow | undefined,
  right: TranscriptMessageRow | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return left.id === right.id &&
    left.role === right.role &&
    left.text === right.text &&
    left.createdAt === right.createdAt;
}

function logSlowStartupStep(label: string, startedAt: number, thresholdMs = 100): void {
  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs >= thresholdMs) {
    console.info(`[pi-gui] startup ${label}: ${elapsedMs}ms`);
  }
}

function resolveSelectedSessionIdFromCatalog(
  workspaceId: string,
  preferredSessionId: string,
  sessions: readonly SessionCatalogEntry[],
): string {
  const workspaceSessions = sessions.filter((session) => session.workspaceId === workspaceId);
  if (!workspaceSessions.length) {
    return "";
  }
  if (
    preferredSessionId &&
    workspaceSessions.some((session) => session.sessionRef.sessionId === preferredSessionId)
  ) {
    return preferredSessionId;
  }
  return workspaceSessions[0]?.sessionRef.sessionId ?? "";
}
