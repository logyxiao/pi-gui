import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type Dispatch, type DragEvent, type KeyboardEvent, type SetStateAction } from "react";
import type { SessionTreeSnapshot } from "@pi-gui/session-driver/types";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import {
  getSelectedSession,
  getSelectedWorkspace,
  type AppView,
  type ComposerAttachment,
  type ComposerImageAttachment,
  type DesktopAppState,
  type NewThreadEnvironment,
  type SelectedTranscriptRecord,
  type StartThreadInput,
  type WorktreeRecord,
  type WorkspaceRecord,
} from "./desktop-state";
import { DiffPanel, type DiffPanelFileRequest } from "./diff-panel";
import { buildModelOptions } from "./composer-commands";
import { parseTreeComposerCommand } from "./composer-commands";
import {
  getDesktopShortcutLabel,
  type DesktopNotificationPermissionStatus,
} from "./ipc";
import { deriveModelOnboardingState } from "./model-onboarding";
import { SkillsView } from "./skills-view";
import { ExtensionsView } from "./extensions-view";
import { SettingsView, type SettingsSection } from "./settings-view";
import { SecondarySurface } from "./secondary-surface";
import { SearchableSelect } from "./searchable-select";
import { NewThreadView } from "./new-thread-view";
import { buildThreadGroups } from "./thread-groups";
import { Sidebar } from "./sidebar";
import { SidebarToggleButton } from "./sidebar-toggle-button";
import { Topbar } from "./topbar";
import { TerminalPanel } from "./terminal-panel";
import { useSlashMenu } from "./hooks/use-slash-menu";
import { useMentionMenu } from "./hooks/use-mention-menu";
import { useThreadSearch } from "./hooks/use-thread-search";
import { useTimelineController } from "./hooks/use-timeline-controller";
import { useWorkspaceMenu } from "./hooks/use-workspace-menu";
import { useDesktopCommands } from "./hooks/use-desktop-commands";
import { useComposerController } from "./hooks/use-composer-controller";
import { buildExtensionDockModel, hasExtensionDockContent } from "./extension-session-ui";
import { ConfirmDialog, type ConfirmDialogProps } from "./confirm-dialog";
import { ThreadView } from "./thread-view";
import { getEffectiveModelRuntime } from "./model-settings";
import { resolveRepoWorkspaceId } from "./workspace-roots";
import {
  extractImageFilesFromClipboardData,
  extractFilesFromDataTransfer,
  readComposerAttachmentsFromFiles,
} from "./composer-attachments";
import { useI18n, type LanguageCode } from "./i18n";

function useDesktopAppState() {
  const [snapshot, setSnapshot] = useState<DesktopAppState | null>(null);
  const [selectedTranscript, setSelectedTranscript] = useState<SelectedTranscriptRecord | null>(null);

  useEffect(() => {
    let active = true;
    const api = window.piApp;
    if (!api) {
      return undefined;
    }

    void Promise.all([api.getState(), api.getSelectedTranscript()]).then(([state, transcript]) => {
      if (!active) {
        return;
      }
      setSnapshot(state);
      setSelectedTranscript(transcript);
    });

    const unsubscribeState = api.onStateChanged((state) => {
      if (active) {
        setSnapshot(state);
      }
    });
    const unsubscribeTranscript = api.onSelectedTranscriptChanged((payload) => {
      if (active) {
        setSelectedTranscript(payload);
      }
    });

    return () => {
      active = false;
      unsubscribeState();
      unsubscribeTranscript();
    };
  }, []);

  return [snapshot, setSnapshot, selectedTranscript] as const;
}

function updateSnapshot(
  api: NonNullable<typeof window.piApp>,
  setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>,
  action: () => Promise<DesktopAppState>,
) {
  return action().then((state) => {
    setSnapshot(state);
    return state;
  });
}

function canTogglePrimarySidebar(view: AppView | undefined): boolean {
  return view === "threads" || view === "new-thread";
}

function useRunningLabel(startedAt: string | undefined) {
  const [label, setLabel] = useState(() => formatRunningLabel(startedAt));

  useEffect(() => {
    setLabel(formatRunningLabel(startedAt));
    if (!startedAt) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setLabel(formatRunningLabel(startedAt));
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [startedAt]);

  return label;
}

function formatRunningLabel(startedAt: string | undefined): string {
  if (!startedAt) {
    return "Working…";
  }

  const diffMs = Math.max(0, Date.now() - Date.parse(startedAt));
  const seconds = Math.max(1, Math.floor(diffMs / 1000));
  if (seconds < 60) {
    return `Working for ${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining === 0 ? `Working for ${minutes}m` : `Working for ${minutes}m ${remaining}s`;
}

export default function App({
  language,
  onSetLanguage,
}: {
  readonly language: LanguageCode;
  readonly onSetLanguage: (language: LanguageCode) => void;
}) {
  const { t } = useI18n();
  const [snapshot, setSnapshot, selectedTranscript] = useDesktopAppState();
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [settingsWorkspaceId, setSettingsWorkspaceId] = useState("");
  const [pendingNewThreadWorkspaceId, setPendingNewThreadWorkspaceId] = useState("");
  const [newThreadRootWorkspaceId, setNewThreadRootWorkspaceId] = useState("");
  const [newThreadEnvironment, setNewThreadEnvironment] = useState<NewThreadEnvironment>("local");
  const [newThreadPrompt, setNewThreadPrompt] = useState("");
  const [newThreadAttachments, setNewThreadAttachments] = useState<readonly ComposerAttachment[]>([]);
  const [newThreadProvider, setNewThreadProvider] = useState<string | undefined>();
  const [newThreadModelId, setNewThreadModelId] = useState<string | undefined>();
  const [newThreadThinkingLevel, setNewThreadThinkingLevel] = useState<string | undefined>();
  const [newThreadComposerError, setNewThreadComposerError] = useState<string | undefined>();
  const [themeMode, setThemeMode] = useState<"system" | "light" | "dark">("system");
  const [notificationPermissionStatus, setNotificationPermissionStatus] =
    useState<DesktopNotificationPermissionStatus>("unknown");
  const [notificationPermissionPending, setNotificationPermissionPending] = useState(false);
  const [dockExpandedBySession, setDockExpandedBySession] = useState<Record<string, boolean>>({});
  const [treeModalState, setTreeModalState] = useState<{
    readonly open: boolean;
    readonly loading: boolean;
    readonly submitting: boolean;
    readonly tree?: SessionTreeSnapshot;
    readonly error?: string;
  }>({
    open: false,
    loading: false,
    submitting: false,
  });
  const [confirmDialog, setConfirmDialog] = useState<
    (Pick<ConfirmDialogProps, "title" | "message" | "confirmLabel" | "cancelLabel" | "tone"> & {
      readonly resolve: (confirmed: boolean) => void;
    }) | null
  >(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const newThreadComposerRef = useRef<HTMLTextAreaElement | null>(null);
  const previousActiveViewRef = useRef<AppView | null>(null);
  const [showDiffPanel, setShowDiffPanel] = useState(false);
  const [openTerminalSessionKeys, setOpenTerminalSessionKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [takeoverTerminalSessionKeys, setTakeoverTerminalSessionKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [terminalHeight, setTerminalHeight] = useState(340);
  const [diffFileRequest, setDiffFileRequest] = useState<DiffPanelFileRequest | null>(null);
  const api = window.piApp;
  const requestConfirm = useCallback(
    (options: Pick<ConfirmDialogProps, "title" | "message" | "confirmLabel" | "cancelLabel" | "tone">) =>
      new Promise<boolean>((resolve) => {
        setConfirmDialog((current) => {
          current?.resolve(false);
          return { ...options, resolve };
        });
      }),
    [],
  );
  const closeConfirmDialog = useCallback((confirmed: boolean) => {
    setConfirmDialog((current) => {
      current?.resolve(confirmed);
      return null;
    });
  }, []);
  const sidebarToggleStateRef = useRef<{
    readonly api: typeof window.piApp;
    readonly activeView: AppView | undefined;
    readonly sidebarCollapsed: boolean;
  }>({
    api,
    activeView: undefined,
    sidebarCollapsed: false,
  });
  sidebarToggleStateRef.current = {
    api,
    activeView: snapshot?.activeView,
    sidebarCollapsed: snapshot?.sidebarCollapsed ?? false,
  };

  useEffect(() => {
    const piApi = window.piApp;
    if (!piApi) return;

    void piApi.getResolvedTheme().then((theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
    });

    void piApi.getThemeMode().then((mode) => {
      setThemeMode(mode);
    });

    const unsub = piApi.onThemeChanged((theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
    });

    return unsub;
  }, []);

  useEffect(() => {
    const piApi = window.piApp;
    if (!piApi?.onNotificationPermissionStatusChanged) {
      return;
    }

    return piApi.onNotificationPermissionStatusChanged((status) => {
      setNotificationPermissionStatus(status);
    });
  }, []);

  const refreshNotificationPermissionStatus = useCallback(() => {
    if (!api?.getNotificationPermissionStatus) {
      return Promise.resolve("unknown" as DesktopNotificationPermissionStatus);
    }

    return api.getNotificationPermissionStatus().then((status) => {
      setNotificationPermissionStatus(status);
      return status;
    });
  }, [api]);

  useEffect(() => {
    if (snapshot?.activeView !== "settings" || settingsSection !== "notifications") {
      return undefined;
    }

    void refreshNotificationPermissionStatus();
    return undefined;
  }, [refreshNotificationPermissionStatus, settingsSection, snapshot?.activeView]);

  const selectedWorkspace = useMemo(
    () => snapshot ? (getSelectedWorkspace(snapshot) ?? snapshot.workspaces[0]) : undefined,
    [snapshot?.selectedWorkspaceId, snapshot?.workspaces],
  );
  const selectedSession = useMemo(
    () => snapshot ? (getSelectedSession(snapshot) ?? selectedWorkspace?.sessions[0]) : undefined,
    [selectedWorkspace, snapshot?.selectedSessionId],
  );
  const {
    activeWorktrees,
    linkedWorktreeByWorkspaceId,
    rootWorkspace,
    rootWorkspaceOptions,
    visibleWorkspaces,
  } = useMemo(() => {
    if (!snapshot) {
      return {
        activeWorktrees: [] as readonly WorktreeRecord[],
        linkedWorktreeByWorkspaceId: new Map<string, WorktreeRecord>(),
        rootWorkspace: undefined as WorkspaceRecord | undefined,
        rootWorkspaceOptions: [] as readonly WorkspaceRecord[],
        visibleWorkspaces: [] as readonly WorkspaceRecord[],
      };
    }

    const workspacesById = new Map(snapshot.workspaces.map((workspace) => [workspace.id, workspace] as const));
    const primaryWorkspaces = snapshot.workspaces.filter((workspace) => workspace.kind === "primary");
    const orphanWorkspaces = snapshot.workspaces.filter(
      (workspace) => workspace.kind === "worktree" && !workspacesById.has(workspace.rootWorkspaceId ?? ""),
    );
    const nextVisibleWorkspaces =
      primaryWorkspaces.length > 0 ? [...primaryWorkspaces, ...orphanWorkspaces] : snapshot.workspaces;
    const nextLinkedWorktreeByWorkspaceId = new Map(
      Object.values(snapshot.worktreesByWorkspace)
        .flat()
        .filter((worktree) => Boolean(worktree.linkedWorkspaceId))
        .map((worktree) => [worktree.linkedWorkspaceId as string, worktree] as const),
    );
    const nextRootWorkspaceId = resolveRepoWorkspaceId(snapshot.workspaces, selectedWorkspace?.id);
    const nextRootWorkspace =
      (nextRootWorkspaceId ? snapshot.workspaces.find((workspace) => workspace.id === nextRootWorkspaceId) : undefined)
      ?? selectedWorkspace;
    const nextRootWorkspaceOptions = [...new Set(snapshot.workspaces.map((workspace) => resolveRepoWorkspaceId(snapshot.workspaces, workspace.id) ?? workspace.id))]
      .map((workspaceId) => snapshot.workspaces.find((workspace) => workspace.id === workspaceId))
      .filter((workspace): workspace is WorkspaceRecord => Boolean(workspace));

    return {
      activeWorktrees: nextRootWorkspace ? snapshot.worktreesByWorkspace[nextRootWorkspace.id] ?? [] : [],
      linkedWorktreeByWorkspaceId: nextLinkedWorktreeByWorkspaceId,
      rootWorkspace: nextRootWorkspace,
      rootWorkspaceOptions: nextRootWorkspaceOptions,
      visibleWorkspaces: nextVisibleWorkspaces,
    };
  }, [selectedWorkspace, snapshot?.workspaces, snapshot?.worktreesByWorkspace]);
  const selectedRuntime = selectedWorkspace ? snapshot?.runtimeByWorkspace[selectedWorkspace.id] : undefined;
  const selectedModelRuntime = snapshot ? getEffectiveModelRuntime(snapshot, selectedWorkspace) : undefined;
  const selectedWorktree = selectedWorkspace ? linkedWorktreeByWorkspaceId.get(selectedWorkspace.id) : undefined;
  const settingsWorkspace = settingsWorkspaceId
    ? rootWorkspaceOptions.find((workspace) => workspace.id === settingsWorkspaceId)
    : undefined;
  const settingsRuntime = settingsWorkspace ? snapshot?.runtimeByWorkspace[settingsWorkspace.id] : undefined;
  const settingsModelRuntime = snapshot ? getEffectiveModelRuntime(snapshot, settingsWorkspace) : undefined;
  const settingsExtensionCommandCompatibility = settingsWorkspace
    ? snapshot?.extensionCommandCompatibilityByWorkspace[settingsWorkspace.id] ?? []
    : [];
  const newThreadWorkspace =
    rootWorkspaceOptions.find((entry) => entry.id === newThreadRootWorkspaceId) ?? rootWorkspaceOptions[0];
  const newThreadRuntime = snapshot ? getEffectiveModelRuntime(snapshot, newThreadWorkspace) : undefined;
  const newThreadDefaultEnabled = buildModelOptions(newThreadRuntime).some(
    (m) => m.providerId === newThreadRuntime?.settings.defaultProvider && m.modelId === newThreadRuntime?.settings.defaultModelId,
  );
  const selectedDefaultEnabled = buildModelOptions(selectedModelRuntime).some(
    (m) => m.providerId === selectedModelRuntime?.settings.defaultProvider && m.modelId === selectedModelRuntime?.settings.defaultModelId,
  );
  const resolvedSessionProvider =
    selectedSession?.config?.provider ??
    (selectedDefaultEnabled ? selectedModelRuntime?.settings.defaultProvider : undefined);
  const resolvedSessionModelId =
    selectedSession?.config?.modelId ??
    (selectedDefaultEnabled ? selectedModelRuntime?.settings.defaultModelId : undefined);
  const resolvedSessionThinkingLevel =
    selectedSession?.config?.thinkingLevel ?? selectedModelRuntime?.settings.defaultThinkingLevel;
  const resolvedNewThreadProvider = newThreadProvider ?? (newThreadDefaultEnabled ? newThreadRuntime?.settings.defaultProvider : undefined);
  const resolvedNewThreadModelId = newThreadModelId ?? (newThreadDefaultEnabled ? newThreadRuntime?.settings.defaultModelId : undefined);
  const resolvedNewThreadThinkingLevel = newThreadThinkingLevel ?? newThreadRuntime?.settings.defaultThinkingLevel;
  const selectedSessionModelOnboarding = deriveModelOnboardingState(selectedModelRuntime, {
    provider: resolvedSessionProvider,
    modelId: resolvedSessionModelId,
  }, t);
  const newThreadModelOnboarding = deriveModelOnboardingState(newThreadRuntime, {
    provider: resolvedNewThreadProvider,
    modelId: resolvedNewThreadModelId,
  }, t);
  const [attachmentsClearedOnSubmit, setAttachmentsClearedOnSubmit] = useState(false);
  const composerAttachments = attachmentsClearedOnSubmit ? [] : (snapshot?.composerAttachments ?? []);
  const queuedComposerMessages = snapshot?.queuedComposerMessages ?? [];
  const editingQueuedMessageId = snapshot?.editingQueuedMessageId;
  const runningLabel = useRunningLabel(selectedSession?.status === "running" ? selectedSession.runningSince : undefined);
  const selectedSessionKey = selectedWorkspace && selectedSession ? `${selectedWorkspace.id}:${selectedSession.id}` : "";
  const isTerminalVisibleForSelectedThread = Boolean(selectedSessionKey) && openTerminalSessionKeys.has(selectedSessionKey);
  const isTerminalTakeoverForSelectedThread = Boolean(selectedSessionKey) && takeoverTerminalSessionKeys.has(selectedSessionKey);
  const activeTranscript =
    selectedTranscript &&
    selectedWorkspace &&
    selectedSession &&
    selectedTranscript.workspaceId === selectedWorkspace.id &&
    selectedTranscript.sessionId === selectedSession.id
      ? selectedTranscript.transcript
      : [];
  const isTranscriptLoading = Boolean(selectedSession) && activeTranscript.length === 0 && (
    !selectedTranscript ||
    selectedTranscript.workspaceId !== selectedWorkspace?.id ||
    selectedTranscript.sessionId !== selectedSession?.id
  );
  const selectedSessionCommands = selectedSession ? snapshot?.sessionCommandsBySession[selectedSessionKey] ?? [] : [];
  const selectedExtensionUi = selectedSession ? snapshot?.sessionExtensionUiBySession[selectedSessionKey] : undefined;
  const selectedWorkspaceCommandCompatibility = selectedWorkspace
    ? snapshot?.extensionCommandCompatibilityByWorkspace[selectedWorkspace.id] ?? []
    : [];
  const timelineController = useTimelineController({
    activeTranscript,
    activeView: snapshot?.activeView,
    selectedSession,
    selectedSessionKey,
  });
  const {
    disableTimelineVirtualization,
    finalizeTimelineVirtualizationDisable,
    handleComposerHeightChange,
    handleTimelineContentHeightChange,
    handleTimelineScroll,
    jumpToLatest,
    preserveBottomForLayoutChange,
    resetForNonThreadView,
    setTimelinePaneElement,
    showJumpToLatest,
    timelinePaneRef,
  } = timelineController;
  const { composerDraft, setComposerDraft } = useComposerController({
    api,
    composerRef,
    onComposerHeightChange: handleComposerHeightChange,
    selectedSessionKey,
    snapshot,
  });
  const threadSearch = useThreadSearch(timelinePaneRef);
  useEffect(() => {
    if (snapshot && snapshot.workspaces.length === 0) {
      setOpenTerminalSessionKeys(new Set());
      setTakeoverTerminalSessionKeys(new Set());
    }
  }, [snapshot]);
  const selectedExtensionDock = useMemo(() => buildExtensionDockModel(selectedExtensionUi), [selectedExtensionUi]);
  const displayedSessionTitle = selectedExtensionUi?.title ?? selectedSession?.title ?? "";
  const activeExtensionDialog = selectedExtensionUi?.pendingDialogs[0];
  const isSelectedExtensionDockExpanded = dockExpandedBySession[selectedSessionKey] ?? false;
  const threadGroups = useMemo(
    () => (snapshot ? buildThreadGroups(snapshot) : []),
    [snapshot?.workspaces, snapshot?.worktreesByWorkspace, snapshot?.workspaceOrder],
  );
  const focusComposer = useCallback(() => {
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
    });
  }, []);
  const toggleTerminal = useCallback(() => {
    if (!selectedSessionKey) {
      return;
    }
    if (openTerminalSessionKeys.has(selectedSessionKey)) {
      setOpenTerminalSessionKeys((current) => {
        const next = new Set(current);
        next.delete(selectedSessionKey);
        return next;
      });
      setTakeoverTerminalSessionKeys((current) => {
        const next = new Set(current);
        next.delete(selectedSessionKey);
        return next;
      });
      return;
    }
    setOpenTerminalSessionKeys((current) => new Set(current).add(selectedSessionKey));
  }, [openTerminalSessionKeys, selectedSessionKey]);
  const focusNewThreadComposer = useCallback(() => {
    window.requestAnimationFrame(() => {
      newThreadComposerRef.current?.focus();
    });
  }, []);
  const updateNewThreadPrompt = useCallback((value: SetStateAction<string>) => {
    setNewThreadComposerError(undefined);
    setNewThreadPrompt(value);
  }, []);

  const handleViewFileInDiff = useCallback((path: string) => {
    setShowDiffPanel(true);
    setDiffFileRequest({ path, nonce: Date.now() });
  }, []);

  const toggleDiffPanel = useCallback(() => {
    preserveBottomForLayoutChange(3);
    setShowDiffPanel((prev) => !prev);
  }, [preserveBottomForLayoutChange]);

  const openSettings = useCallback((workspaceId?: string, section?: SettingsSection) => {
    if (!api) {
      return;
    }
    const nextWorkspaceId =
      workspaceId && rootWorkspaceOptions.some((workspace) => workspace.id === workspaceId)
        ? workspaceId
        : settingsWorkspace?.id || rootWorkspaceOptions[0]?.id || "";
    if (nextWorkspaceId) {
      setSettingsWorkspaceId(nextWorkspaceId);
    }
    if (section) {
      setSettingsSection(section);
    }
    void updateSnapshot(api, setSnapshot, () => api.setActiveView("settings"));
  }, [api, rootWorkspaceOptions, settingsWorkspace?.id]);

  const closeTreeModal = useCallback(() => {
    setTreeModalState((current) =>
      current.submitting
        ? current
        : {
            open: false,
            loading: false,
            submitting: false,
          },
    );
    focusComposer();
  }, []);

  const openTreeModal = useCallback(() => {
    if (!api || !selectedWorkspace || !selectedSession) {
      return;
    }

    setTreeModalState({
      open: true,
      loading: true,
      submitting: false,
    });
    setComposerDraft("");

    void api
      .getSessionTree({
        workspaceId: selectedWorkspace.id,
        sessionId: selectedSession.id,
      })
      .then((tree) => {
        setTreeModalState({
          open: true,
          loading: false,
          submitting: false,
          tree,
        });
      })
      .catch((error) => {
        setTreeModalState({
          open: true,
          loading: false,
          submitting: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, [api, selectedSession, selectedWorkspace]);

  const navigateTreeSelection = useCallback(
    (targetId: string, options?: { readonly summarize?: boolean; readonly customInstructions?: string }) => {
      if (!api || !selectedWorkspace || !selectedSession) {
        return;
      }

      setTreeModalState((current) => ({ ...current, submitting: true, error: undefined }));
      void api
        .navigateSessionTree(
          {
            workspaceId: selectedWorkspace.id,
            sessionId: selectedSession.id,
          },
          targetId,
          options,
        )
        .then(({ state, result }) => {
          setSnapshot(state);
          setTreeModalState({
            open: false,
            loading: false,
            submitting: false,
          });
          setComposerDraft((current) =>
            !current.trim() && result.editorText ? result.editorText : state.composerDraft,
          );
          focusComposer();
        })
        .catch((error) => {
          setTreeModalState((current) => ({
            ...current,
            submitting: false,
            error: error instanceof Error ? error.message : String(error),
          }));
        });
    },
    [api, selectedSession, selectedWorkspace],
  );

  const slashMenu = useSlashMenu({
    composerDraft,
    setComposerDraft,
    selectedRuntime,
    selectedModelRuntime,
    sessionCommands: selectedSessionCommands,
    commandCompatibility: selectedWorkspaceCommandCompatibility,
    selectedSessionKey,
    selectedSession,
    selectedWorkspace,
    isRunning: selectedSession?.status === "running",
    api,
    setSnapshot,
    focusComposer,
    openSettings,
    updateSnapshot,
    allowTreeCommand: true,
    onRunTreeCommand: openTreeModal,
  });

  const mentionMenu = useMentionMenu({
    composerDraft,
    setComposerDraft,
    composerRef,
    workspaceId: selectedWorkspace?.id,
    api,
  });

  const newThreadSlashMenu = useSlashMenu({
    composerDraft: newThreadPrompt,
    setComposerDraft: updateNewThreadPrompt,
    selectedRuntime: newThreadRuntime,
    selectedModelRuntime: newThreadRuntime,
    sessionCommands: [],
    commandCompatibility: [],
    selectedSessionKey: `new-thread:${newThreadWorkspace?.id ?? ""}`,
    selectedSession: undefined,
    selectedWorkspace: newThreadWorkspace,
    isRunning: false,
    api,
    setSnapshot,
    focusComposer: focusNewThreadComposer,
    openSettings,
    updateSnapshot,
    allowTreeCommand: false,
    immediateCommandMode: "prefill",
    onSelectModelOption: (provider, modelId) => {
      setNewThreadProvider(provider);
      setNewThreadModelId(modelId);
    },
    onSelectThinkingOption: setNewThreadThinkingLevel,
    onSelectLoginProvider: (providerId) => {
      if (!api || !newThreadWorkspace) {
        return;
      }
      void updateSnapshot(api, setSnapshot, () => api.loginProvider(newThreadWorkspace.id, providerId));
    },
    onSelectLogoutProvider: (providerId) => {
      if (!api || !newThreadWorkspace) {
        return;
      }
      void updateSnapshot(api, setSnapshot, () => api.logoutProvider(newThreadWorkspace.id, providerId));
    },
  });

  const newThreadMentionMenu = useMentionMenu({
    composerDraft: newThreadPrompt,
    setComposerDraft: setNewThreadPrompt,
    composerRef: newThreadComposerRef,
    workspaceId: newThreadWorkspace?.id,
    api,
  });

  const wsMenu = useWorkspaceMenu({
    api,
    requestConfirm,
    setSnapshot,
    t,
    updateSnapshot,
  });

  useEffect(() => {
    const sessionExtensionUiBySession = snapshot?.sessionExtensionUiBySession;
    if (!sessionExtensionUiBySession) {
      setDockExpandedBySession((current) => (Object.keys(current).length > 0 ? {} : current));
      return;
    }

    setDockExpandedBySession((current) => {
      let next: Record<string, boolean> | undefined;
      for (const [sessionKey, expanded] of Object.entries(current)) {
        if (!expanded && sessionExtensionUiBySession[sessionKey]) {
          continue;
        }
        if (hasExtensionDockContent(sessionExtensionUiBySession[sessionKey])) {
          continue;
        }
        if (!next) {
          next = { ...current };
        }
        delete next[sessionKey];
      }
      return next ?? current;
    });
  }, [snapshot?.sessionExtensionUiBySession]);

  useEffect(() => {
    if (rootWorkspaceOptions.length === 0) {
      setSettingsWorkspaceId("");
      setPendingNewThreadWorkspaceId("");
      setNewThreadRootWorkspaceId("");
      setNewThreadEnvironment("local");
      setNewThreadAttachments([]);
      return;
    }
    setSettingsWorkspaceId((current) =>
      rootWorkspaceOptions.some((workspace) => workspace.id === current) ? current : (current || rootWorkspaceOptions[0]?.id || ""),
    );
    setNewThreadRootWorkspaceId((current) =>
      rootWorkspaceOptions.some((workspace) => workspace.id === current) ? current : (current || rootWorkspaceOptions[0]?.id || ""),
    );
  }, [rootWorkspaceOptions]);

  useEffect(() => {
    if (!snapshot || !pendingNewThreadWorkspaceId) {
      return;
    }
    const nextRootWorkspaceId = resolveRepoWorkspaceId(snapshot.workspaces, pendingNewThreadWorkspaceId);
    if (!nextRootWorkspaceId || !rootWorkspaceOptions.some((workspace) => workspace.id === nextRootWorkspaceId)) {
      return;
    }
    setNewThreadRootWorkspaceId(nextRootWorkspaceId);
    setPendingNewThreadWorkspaceId("");
  }, [pendingNewThreadWorkspaceId, rootWorkspaceOptions, snapshot]);

  const resetNewThreadSurface = useCallback((workspaceId?: string) => {
    const nextWorkspaceId =
      (workspaceId && (
        rootWorkspaceOptions.find((workspace) => workspace.id === workspaceId)?.id ||
        (snapshot ? resolveRepoWorkspaceId(snapshot.workspaces, workspaceId) : undefined)
      )) ||
      rootWorkspace?.id ||
      visibleWorkspaces[0]?.id ||
      "";
    if (nextWorkspaceId) {
      setNewThreadRootWorkspaceId(nextWorkspaceId);
    }
    setNewThreadEnvironment("local");
    setNewThreadPrompt("");
    setNewThreadAttachments([]);
    setNewThreadProvider(undefined);
    setNewThreadModelId(undefined);
    setNewThreadThinkingLevel(undefined);
    setNewThreadComposerError(undefined);
  }, [rootWorkspace?.id, rootWorkspaceOptions, snapshot?.workspaces, visibleWorkspaces]);

  const primarySidebarToggleVisible = canTogglePrimarySidebar(snapshot?.activeView);
  const handleTogglePrimarySidebar = useCallback(() => {
    const sidebarState = sidebarToggleStateRef.current;
    const sidebarApi = sidebarState.api;
    if (!sidebarApi || !canTogglePrimarySidebar(sidebarState.activeView)) {
      return false;
    }
    void updateSnapshot(sidebarApi, setSnapshot, () => sidebarApi.setSidebarCollapsed(!sidebarState.sidebarCollapsed));
    return true;
  }, []);
  const sidebarToggleShortcutLabel = api ? getDesktopShortcutLabel(api.platform, "B") : "";

  const setActiveView = useCallback((view: AppView) => {
    if (!api) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setActiveView(view));
  }, [api]);

  const openNewThreadSurface = useCallback((workspaceId?: string) => {
    setPendingNewThreadWorkspaceId("");
    resetNewThreadSurface(workspaceId);
    setActiveView("new-thread");
  }, [resetNewThreadSurface, setActiveView]);

  const openNewThreadForSelectedWorkspace = useCallback(() => {
    openNewThreadSurface(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id);
  }, [openNewThreadSurface, selectedWorkspace?.id, selectedWorkspace?.rootWorkspaceId]);

  const handlePastedClipboardImage = useCallback((clipboardImage: ComposerImageAttachment) => {
    const activeElement = document.activeElement;
    if (activeElement === composerRef.current) {
      if (!api) {
        return;
      }
      void updateSnapshot(api, setSnapshot, () => api.addComposerAttachments([clipboardImage]));
      return;
    }

    if (activeElement === newThreadComposerRef.current) {
      setNewThreadAttachments((current) => [...current, clipboardImage]);
    }
  }, [api]);

  const handleWorkspacePicked = useCallback((workspaceId: string) => {
    setPendingNewThreadWorkspaceId(workspaceId);
    resetNewThreadSurface();
  }, [resetNewThreadSurface]);

  const openSettingsForSelectedWorkspace = useCallback(() => {
    openSettings(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id);
  }, [openSettings, selectedWorkspace?.id, selectedWorkspace?.rootWorkspaceId]);

  useDesktopCommands({
    api,
    threadSearch,
    onOpenSettings: openSettingsForSelectedWorkspace,
    onOpenNewThread: openNewThreadForSelectedWorkspace,
    onToggleTerminal: toggleTerminal,
    onToggleSidebar: handleTogglePrimarySidebar,
    onToggleDiffPanel: toggleDiffPanel,
    onWorkspacePicked: handleWorkspacePicked,
    onClipboardImagePasted: handlePastedClipboardImage,
  });

  const handleArchiveSession = useCallback((target: { workspaceId: string; sessionId: string }) => {
    if (!api) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.archiveSession(target));
  }, [api]);

  const handleSelectSession = useCallback((target: { workspaceId: string; sessionId: string }) => {
    if (!api) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.selectSession(target)).then(() => {
      focusComposer();
    });
  }, [api, focusComposer]);

  const handleUnarchiveSession = useCallback((target: { workspaceId: string; sessionId: string }) => {
    if (!api) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.unarchiveSession(target));
  }, [api]);

  useEffect(() => {
    setTreeModalState((current) =>
      current.open
        ? {
            open: false,
            loading: false,
            submitting: false,
          }
        : current,
    );
  }, [selectedSessionKey, snapshot?.activeView]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    if (snapshot.activeView === "new-thread" && previousActiveViewRef.current !== "new-thread") {
      const nextRootWorkspaceId = resolveRepoWorkspaceId(snapshot.workspaces, selectedWorkspace?.id);
      if (nextRootWorkspaceId) {
        setNewThreadRootWorkspaceId(nextRootWorkspaceId);
      }
    }

    if (snapshot.activeView !== "threads") {
      resetForNonThreadView();
    }

    if (
      snapshot.activeView === "threads" &&
      previousActiveViewRef.current !== "threads" &&
      selectedSession
    ) {
      focusComposer();
      preserveBottomForLayoutChange(1);
    }

    previousActiveViewRef.current = snapshot.activeView;
  }, [preserveBottomForLayoutChange, resetForNonThreadView, selectedSession, selectedWorkspace?.id, snapshot]);

  if (!api || !snapshot) {
    return (
      <div className="shell shell--loading">
        <main className="loading-card">
          <div className="loading-card__eyebrow">{t("common.appName")}</div>
          <h1>{t("common.loadingSessions")}</h1>
          <p>{t("common.restoreState")}</p>
        </main>
      </div>
    );
  }

  const showTerminalTakeover = isTerminalVisibleForSelectedThread && isTerminalTakeoverForSelectedThread && Boolean(selectedWorkspace);
  const mainClassName = [
    "main",
    showDiffPanel ? "main--with-diff" : "",
    isTerminalVisibleForSelectedThread ? "main--with-terminal" : "",
    showTerminalTakeover ? "main--terminal-takeover" : "",
  ].filter(Boolean).join(" ");
  const terminalPanel = isTerminalVisibleForSelectedThread && selectedWorkspace ? (
    <TerminalPanel
      workspace={selectedWorkspace}
      sessionId={selectedSession?.id ?? ""}
      height={terminalHeight}
      isTakeover={isTerminalTakeoverForSelectedThread}
      onHeightChange={(nextHeight) => {
        setTerminalHeight(nextHeight);
        setTakeoverTerminalSessionKeys((current) => {
          const next = new Set(current);
          next.delete(selectedSessionKey);
          return next;
        });
      }}
      onToggleTakeover={() => {
        setTakeoverTerminalSessionKeys((current) => {
          const next = new Set(current);
          if (next.has(selectedSessionKey)) {
            next.delete(selectedSessionKey);
          } else {
            next.add(selectedSessionKey);
          }
          return next;
        });
      }}
      onHide={() => {
        setOpenTerminalSessionKeys((current) => {
          const next = new Set(current);
          next.delete(selectedSessionKey);
          return next;
        });
        setTakeoverTerminalSessionKeys((current) => {
          const next = new Set(current);
          next.delete(selectedSessionKey);
          return next;
        });
        focusComposer();
      }}
    />
  ) : null;

  const handleSelectNewThreadWorkspace = (workspaceId: string) => {
    setPendingNewThreadWorkspaceId("");
    setNewThreadRootWorkspaceId(workspaceId);
    setNewThreadAttachments([]);
    setNewThreadProvider(undefined);
    setNewThreadModelId(undefined);
    setNewThreadThinkingLevel(undefined);
    setNewThreadComposerError(undefined);
  };

  const submitComposerDraft = (options: { readonly deliverAs?: "steer" | "followUp" } = {}) => {
    if (!selectedSession) {
      return;
    }

    const hasComposerInput = composerDraft.trim().length > 0 || composerAttachments.length > 0;
    if (selectedSession.status === "running" && !hasComposerInput) {
      void updateSnapshot(api, setSnapshot, () => api.cancelCurrentRun());
      return;
    }

    if (!hasComposerInput) {
      return;
    }
    if (selectedSessionModelOnboarding.requiresModelSelection) {
      return;
    }

    const treeCommand = parseTreeComposerCommand(composerDraft);
    if (treeCommand?.type === "error") {
      setSnapshot((current) =>
        current
          ? {
              ...current,
              lastError: treeCommand.message,
            }
          : current,
      );
      return;
    }
    if (treeCommand?.type === "tree") {
      openTreeModal();
      return;
    }

    const previousDraft = composerDraft;
    setComposerDraft("");
    setAttachmentsClearedOnSubmit(true);
    void (async () => {
      const nextState = await updateSnapshot(api, setSnapshot, () =>
        api.submitComposer(previousDraft, selectedSession.status === "running" ? { deliverAs: options.deliverAs ?? "followUp" } : undefined),
      );
      setComposerDraft(nextState.composerDraft);
      setAttachmentsClearedOnSubmit(false);
    })().catch(() => {
      setComposerDraft(previousDraft);
      setAttachmentsClearedOnSubmit(false);
    });
  };

  const handlePickAttachments = () => {
    void updateSnapshot(api, setSnapshot, () => api.pickComposerAttachments());
  };

  const handleRemoveAttachment = (attachmentId: string) => {
    void updateSnapshot(api, setSnapshot, () => api.removeComposerAttachment(attachmentId));
  };

  const handleEditQueuedMessage = (messageId: string) => {
    void updateSnapshot(api, setSnapshot, () => api.editQueuedComposerMessage(messageId, composerDraft)).then(() => {
      composerRef.current?.focus();
    });
  };

  const handleCancelQueuedEdit = () => {
    void updateSnapshot(api, setSnapshot, () => api.cancelQueuedComposerEdit()).then(() => {
      composerRef.current?.focus();
    });
  };

  const handleRemoveQueuedMessage = (messageId: string) => {
    void updateSnapshot(api, setSnapshot, () => api.removeQueuedComposerMessage(messageId));
  };

  const handleSteerQueuedMessage = (messageId: string) => {
    void updateSnapshot(api, setSnapshot, () => api.steerQueuedComposerMessage(messageId));
  };

  const handleNewThreadAddAttachments = (files: File[]) => {
    void readComposerAttachmentsFromFiles(files).then((attachments) => {
      if (attachments.length === 0) {
        return;
      }
      setNewThreadAttachments((current) => [...current, ...attachments]);
    });
  };

  const handleNewThreadRemoveAttachment = (attachmentId: string) => {
    setNewThreadAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  };

  const handleImagePaste = (event: ClipboardEvent<HTMLDivElement>, onFiles: (files: File[]) => void) => {
    const files = extractImageFilesFromClipboardData(event.clipboardData);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    onFiles(files);
  };

  const handleAttachmentDrop = (event: DragEvent<HTMLDivElement>, onFiles: (files: File[]) => void) => {
    event.preventDefault();
    const files = extractFilesFromDataTransfer(event.dataTransfer);
    if (files.length === 0) {
      return;
    }
    onFiles(files);
  };

  const handleComposerPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    handleImagePaste(event, (files) => {
      void addAttachmentsToSessionComposer(files);
    });
  };

  const handleNewThreadComposerPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    handleImagePaste(event, handleNewThreadAddAttachments);
  };

  const handleComposerDrop = (event: DragEvent<HTMLDivElement>) => {
    handleAttachmentDrop(event, (files) => {
      void addAttachmentsToSessionComposer(files);
    });
  };

  const handleNewThreadComposerDrop = (event: DragEvent<HTMLDivElement>) => {
    handleAttachmentDrop(event, handleNewThreadAddAttachments);
  };

  async function addAttachmentsToSessionComposer(files: File[]) {
    if (!api) {
      return;
    }
    const valid = await readComposerAttachmentsFromFiles(files);
    if (valid.length === 0) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.addComposerAttachments(valid));
  }

  const handleClipboardImageShortcut = (
    event: KeyboardEvent<HTMLTextAreaElement>,
    onImage: (attachment: ComposerImageAttachment) => void,
  ): boolean => {
    if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.key.toLowerCase() !== "v") {
      return false;
    }

    event.preventDefault();
    void api?.readClipboardImage().then((clipboardImage) => {
      if (clipboardImage) {
        onImage(clipboardImage);
      }
    });
    return true;
  };

  const handleSetSessionModel = (provider: string, modelId: string) => {
    if (!selectedWorkspace || !selectedSession) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () =>
      api.setSessionModel(selectedWorkspace.id, selectedSession.id, provider, modelId),
    );
  };

  const handleSetSessionThinking = (level: string) => {
    if (!selectedWorkspace || !selectedSession) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () =>
      api.setSessionThinkingLevel(
        selectedWorkspace.id,
        selectedSession.id,
        level as NonNullable<RuntimeSnapshot["settings"]["defaultThinkingLevel"]>,
      ),
    );
  };

  const handleSetDefaultModel = (provider: string, modelId: string) => {
    if (!settingsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setDefaultModel(settingsWorkspace.id, provider, modelId));
  };

  const handleSetThinkingLevel = (thinkingLevel: RuntimeSnapshot["settings"]["defaultThinkingLevel"]) => {
    if (!settingsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setDefaultThinkingLevel(settingsWorkspace.id, thinkingLevel));
  };

  const handleToggleSkillCommands = (enabled: boolean) => {
    if (!settingsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setEnableSkillCommands(settingsWorkspace.id, enabled));
  };

  const handleSetScopedModelPatterns = (patterns: readonly string[]) => {
    if (!settingsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setScopedModelPatterns(settingsWorkspace.id, patterns));
  };

  const handleSetModelSettingsScopeMode = (mode: "app-global" | "per-repo") => {
    if (!api) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setModelSettingsScopeMode(mode));
  };

  const handleLoginProvider = (providerId: string) => {
    if (!settingsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.loginProvider(settingsWorkspace.id, providerId));
  };

  const handleLogoutProvider = (providerId: string) => {
    if (!settingsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.logoutProvider(settingsWorkspace.id, providerId));
  };

  const handleSetProviderApiKey = async (providerId: string, apiKey: string): Promise<string | undefined> => {
    if (!api || !settingsWorkspace) {
      return "Select a workspace first.";
    }
    const state = await updateSnapshot(api, setSnapshot, () =>
      api.setProviderApiKey(settingsWorkspace.id, providerId, apiKey),
    );
    return state.lastError;
  };

  const handleRemoveProviderApiKey = async (providerId: string): Promise<string | undefined> => {
    if (!api || !settingsWorkspace) {
      return "Select a workspace first.";
    }
    const state = await updateSnapshot(api, setSnapshot, () =>
      api.logoutProvider(settingsWorkspace.id, providerId),
    );
    return state.lastError;
  };

  const handleToggleSkill = (filePath: string, enabled: boolean) => {
    if (!settingsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setSkillEnabled(settingsWorkspace.id, filePath, enabled));
  };

  const handleOpenSkillFolder = (filePath: string) => {
    if (!settingsWorkspace) {
      return;
    }
    void api.openSkillInFinder(settingsWorkspace.id, filePath);
  };

  const handleToggleExtension = (filePath: string, enabled: boolean) => {
    if (!settingsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setExtensionEnabled(settingsWorkspace.id, filePath, enabled));
  };

  const handleOpenExtensionFolder = (filePath: string) => {
    if (!settingsWorkspace) {
      return;
    }
    void api.openExtensionInFinder(settingsWorkspace.id, filePath);
  };

  const handleTrySkill = (command: string) => {
    void updateSnapshot(api, setSnapshot, () => api.setActiveView("threads"));
    slashMenu.fillComposerFromSlash(command);
  };

  const handleSetThemeMode = (mode: "system" | "light" | "dark") => {
    if (!api) return;
    setThemeMode(mode);
    void api.setThemeMode(mode);
  };

  const handleSetNotificationPreferences = (preferences: Partial<DesktopAppState["notificationPreferences"]>) => {
    void updateSnapshot(api, setSnapshot, () => api.setNotificationPreferences(preferences));
  };

  const handleSetIntegratedTerminalShell = (shellPath: string) => {
    void updateSnapshot(api, setSnapshot, () => api.setIntegratedTerminalShell(shellPath));
  };

  const handleRequestNotificationPermission = () => {
    if (!api?.requestNotificationPermission) {
      return;
    }
    setNotificationPermissionPending(true);
    void api
      .requestNotificationPermission()
      .then((status) => {
        setNotificationPermissionStatus(status);
      })
      .finally(() => {
        setNotificationPermissionPending(false);
      });
  };

  const handleOpenSystemNotificationSettings = () => {
    if (!api?.openSystemNotificationSettings) {
      return;
    }
    setNotificationPermissionPending(true);
    void api
      .openSystemNotificationSettings()
      .finally(() => {
        setNotificationPermissionPending(false);
      });
  };

  const handleRespondToExtensionDialog = (
    response:
      | { readonly requestId: string; readonly value: string }
      | { readonly requestId: string; readonly confirmed: boolean }
      | { readonly requestId: string; readonly cancelled: true },
  ) => {
    if (!selectedWorkspace || !selectedSession) {
      return;
    }

    void updateSnapshot(api, setSnapshot, () =>
      api.respondToHostUiRequest(selectedWorkspace.id, selectedSession.id, response),
    ).then(() => {
      focusComposer();
    });
  };

  const handleToggleExtensionDock = () => {
    if (!selectedExtensionDock) {
      return;
    }

    setDockExpandedBySession((current) => ({
      ...current,
      [selectedSessionKey]: !(current[selectedSessionKey] ?? false),
    }));
  };

  const handleStartThread = () => {
    if (!newThreadRootWorkspaceId || (!newThreadPrompt.trim() && newThreadAttachments.length === 0)) {
      return;
    }
    if (newThreadModelOnboarding.requiresModelSelection) {
      return;
    }
    const treeCommand = parseTreeComposerCommand(newThreadPrompt);
    if (treeCommand?.type === "error") {
      setNewThreadComposerError(treeCommand.message);
      return;
    }
    if (treeCommand?.type === "tree") {
      setNewThreadComposerError("/tree is only available inside an existing session.");
      return;
    }
    const modelConfig = {
      prompt: newThreadPrompt,
      attachments: newThreadAttachments,
      provider: resolvedNewThreadProvider,
      modelId: resolvedNewThreadModelId,
      thinkingLevel: resolvedNewThreadThinkingLevel,
    };
    const input: StartThreadInput = {
      rootWorkspaceId: newThreadRootWorkspaceId,
      environment: newThreadEnvironment,
      ...modelConfig,
    };
    wsMenu.expandWorkspace(newThreadRootWorkspaceId);
    void updateSnapshot(api, setSnapshot, () =>
      api.startThread(input),
    ).then(() => {
      setNewThreadPrompt("");
      setNewThreadAttachments([]);
      setNewThreadProvider(undefined);
      setNewThreadModelId(undefined);
      setNewThreadThinkingLevel(undefined);
      setNewThreadEnvironment("local");
    });
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (handleClipboardImageShortcut(event, (clipboardImage) => {
      void updateSnapshot(api, setSnapshot, () => api.addComposerAttachments([clipboardImage]));
    })) {
      return;
    }

    if (mentionMenu.handleMentionKeyDown(event)) {
      return;
    }

    if (slashMenu.handleSlashKeyDown(event)) {
      return;
    }

    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && selectedSession?.status === "running") {
      event.preventDefault();
      submitComposerDraft({ deliverAs: (event.metaKey || event.ctrlKey) ? "steer" : "followUp" });
      return;
    }

    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    if (!composerDraft.trim() && composerAttachments.length === 0) {
      return;
    }
    if (selectedSessionModelOnboarding.requiresModelSelection) {
      return;
    }

    submitComposerDraft();
  };

  const handleNewThreadComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (handleClipboardImageShortcut(event, (clipboardImage) => {
      setNewThreadAttachments((current) => [...current, clipboardImage]);
    })) {
      return;
    }

    if (newThreadMentionMenu.handleMentionKeyDown(event)) {
      return;
    }

    if (newThreadSlashMenu.handleSlashKeyDown(event)) {
      return;
    }

    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    if (!newThreadPrompt.trim() && newThreadAttachments.length === 0) {
      return;
    }
    if (newThreadModelOnboarding.requiresModelSelection) {
      return;
    }

    handleStartThread();
  };

  const settingsNav = [
    { id: "appearance", label: t("settings.nav.appearance") },
    { id: "general", label: t("settings.nav.general") },
    { id: "providers", label: t("settings.nav.providers") },
    { id: "models", label: t("settings.nav.models") },
    { id: "skills", label: t("settings.nav.skills") },
    { id: "extensions", label: t("settings.nav.extensions") },
    { id: "notifications", label: t("settings.nav.notifications") },
  ] as const;

  if (snapshot.activeView === "settings") {
    return (
      <SecondarySurface
        activeNavId={settingsSection}
        navItems={settingsNav}
        onBack={() => setActiveView("threads")}
        onSelectNav={(section) => setSettingsSection(section as SettingsSection)}
        testId="settings-surface"
        title={t("settings.title")}
      >
        {settingsSection === "providers" || settingsSection === "skills" || settingsSection === "extensions" || (settingsSection === "models" && snapshot.modelSettingsScopeMode === "per-repo") ? (
          <div className="surface-toolbar">
            <label className="surface-toolbar__field">
              <span>{t("common.workspace")}</span>
              <SearchableSelect
                value={settingsWorkspace?.id ?? ""}
                placeholder={t("common.workspace")}
                searchPlaceholder={t("common.workspace")}
                options={rootWorkspaceOptions.map((workspace) => ({ value: workspace.id, label: workspace.name }))}
                onChange={(value) => setSettingsWorkspaceId(value)}
              />
            </label>
          </div>
        ) : null}
        <SettingsView
          workspace={settingsWorkspace}
          runtime={settingsSection === "models" ? settingsModelRuntime : settingsRuntime}
          section={settingsSection}
          notificationPreferences={snapshot.notificationPreferences}
          notificationPermissionStatus={notificationPermissionStatus}
          notificationPermissionPending={notificationPermissionPending}
          modelSettingsScopeMode={snapshot.modelSettingsScopeMode}
          integratedTerminalShell={snapshot.integratedTerminalShell}
          themeMode={themeMode}
          language={language}
          onLoginProvider={handleLoginProvider}
          onLogoutProvider={handleLogoutProvider}
          onSetProviderApiKey={handleSetProviderApiKey}
          onRemoveProviderApiKey={handleRemoveProviderApiKey}
          onSetModelSettingsScopeMode={handleSetModelSettingsScopeMode}
          onSetDefaultModel={handleSetDefaultModel}
          onSetNotificationPreferences={handleSetNotificationPreferences}
          onSetIntegratedTerminalShell={handleSetIntegratedTerminalShell}
          onRequestNotificationPermission={handleRequestNotificationPermission}
          onOpenSystemNotificationSettings={handleOpenSystemNotificationSettings}
          onSetThemeMode={handleSetThemeMode}
          onSetLanguage={onSetLanguage}
          onSetThinkingLevel={handleSetThinkingLevel}
          onToggleSkillCommands={handleToggleSkillCommands}
          commandCompatibility={settingsExtensionCommandCompatibility}
          onRefreshRuntime={() => {
            if (!settingsWorkspace) {
              return;
            }
            void updateSnapshot(api, setSnapshot, () => api.refreshRuntime(settingsWorkspace.id));
          }}
          onOpenSkillFolder={handleOpenSkillFolder}
          onToggleSkill={handleToggleSkill}
          onTrySkill={(skill) =>
            handleTrySkill(
              skill.filePath
                ? `${skill.slashCommand} `
                : "Create a new skill for this workspace and explain which files you will add.",
            )
          }
          onOpenExtensionFolder={handleOpenExtensionFolder}
          onToggleExtension={handleToggleExtension}
        />
      </SecondarySurface>
    );
  }

  const shellClassName = `shell shell--platform-${api.platform}${snapshot.sidebarCollapsed ? " shell--sidebar-collapsed" : ""}`;

  return (
    <div className={shellClassName}>
      {primarySidebarToggleVisible && snapshot.sidebarCollapsed ? (
        <SidebarToggleButton
          collapsed={snapshot.sidebarCollapsed}
          shortcutLabel={sidebarToggleShortcutLabel}
          onToggle={handleTogglePrimarySidebar}
        />
      ) : null}
      {!snapshot.sidebarCollapsed ? (
        <Sidebar
          activeView={snapshot.activeView}
          selectedWorkspace={selectedWorkspace}
          selectedSession={selectedSession}
          visibleWorkspaces={visibleWorkspaces}
          threadGroups={threadGroups}
          linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
          wsMenu={wsMenu}
          api={api}
          setSnapshot={setSnapshot}
          updateSnapshot={updateSnapshot}
          sidebarCollapsed={snapshot.sidebarCollapsed}
          sidebarToggleVisible={primarySidebarToggleVisible}
          sidebarToggleShortcutLabel={sidebarToggleShortcutLabel}
          onToggleSidebar={handleTogglePrimarySidebar}
          onNewThread={openNewThreadForSelectedWorkspace}
          onOpenSettings={openSettings}
          onArchiveSession={handleArchiveSession}
          onSelectSession={handleSelectSession}
          onUnarchiveSession={handleUnarchiveSession}
        />
      ) : null}

      <main className={mainClassName}>
        <Topbar
          activeView={snapshot.activeView}
          rootWorkspace={rootWorkspace}
          selectedWorkspace={selectedWorkspace}
          selectedSession={selectedSession}
          selectedSessionTitle={displayedSessionTitle || selectedSession?.title}
          selectedWorktree={selectedWorktree}
          activeWorktrees={activeWorktrees}
          workspaces={snapshot.workspaces}
          wsMenu={wsMenu}
          api={api}
          setSnapshot={setSnapshot}
          updateSnapshot={updateSnapshot}
          terminalAvailable={Boolean(selectedSessionKey)}
          terminalVisible={isTerminalVisibleForSelectedThread}
          onToggleTerminal={toggleTerminal}
          showDiffPanel={showDiffPanel}
          onToggleDiffPanel={toggleDiffPanel}
        />

        {showTerminalTakeover ? (
          terminalPanel
        ) : (
          <>
        {snapshot.activeView === "new-thread" ? (
          rootWorkspaceOptions.length > 0 ? (
            <NewThreadView
              workspaces={rootWorkspaceOptions}
              selectedWorkspaceId={newThreadRootWorkspaceId || rootWorkspaceOptions[0]?.id || ""}
              runtime={newThreadRuntime}
              environment={newThreadEnvironment}
              prompt={newThreadPrompt}
              attachments={newThreadAttachments}
              lastError={newThreadComposerError}
              provider={resolvedNewThreadProvider}
              modelId={resolvedNewThreadModelId}
              thinkingLevel={resolvedNewThreadThinkingLevel}
              modelOnboarding={newThreadModelOnboarding}
              composerRef={newThreadComposerRef}
              activeSlashCommand={newThreadSlashMenu.activeSlashFlow?.command}
              activeSlashCommandMeta={newThreadSlashMenu.activeSlashFlow?.command?.description}
              slashSections={newThreadSlashMenu.slashSections}
              slashOptions={newThreadSlashMenu.slashOptions}
              selectedSlashCommand={newThreadSlashMenu.activeSlashOptionCommand ?? newThreadSlashMenu.selectedSlashCommand}
              selectedSlashOption={newThreadSlashMenu.selectedSlashOption}
              showSlashMenu={newThreadSlashMenu.showSlashMenu}
              showSlashOptionMenu={newThreadSlashMenu.showSlashOptionMenu}
              slashOptionEmptyState={newThreadSlashMenu.slashOptionEmptyState}
              showMentionMenu={newThreadMentionMenu.showMentionMenu}
              mentionOptions={newThreadMentionMenu.mentionOptions}
              selectedMentionIndex={newThreadMentionMenu.selectedIndex}
              onChangePrompt={setNewThreadPrompt}
              onSelectEnvironment={setNewThreadEnvironment}
              onSelectWorkspace={handleSelectNewThreadWorkspace}
              onSetModel={(provider, modelId) => { setNewThreadProvider(provider); setNewThreadModelId(modelId); }}
              onSetThinking={setNewThreadThinkingLevel}
              onOpenModelSettings={(section) => openSettings(newThreadWorkspace?.id, section)}
              onComposerKeyDown={handleNewThreadComposerKeyDown}
              onComposerPaste={handleNewThreadComposerPaste}
              onComposerDrop={handleNewThreadComposerDrop}
              onClearSlashCommand={newThreadSlashMenu.resetSlashUi}
              onSelectSlashCommand={(command) => {
                newThreadSlashMenu.applySlashCommandSelection(command, "click");
              }}
              onSelectSlashOption={(option) => {
                newThreadSlashMenu.applySlashOptionSelection(option);
              }}
              onSelectMention={newThreadMentionMenu.insertMention}
              onAddAttachments={handleNewThreadAddAttachments}
              onRemoveAttachment={handleNewThreadRemoveAttachment}
              onSubmit={handleStartThread}
            />
          ) : (
            <section className="canvas canvas--empty">
              <div className="empty-panel">
                <div className="session-header__eyebrow">{t("empty.workspaceEyebrow")}</div>
                <h1>{t("empty.openFolderTitle")}</h1>
                <p>{t("empty.newThreadNoFolderBody")}</p>
              </div>
            </section>
          )
        ) : selectedWorkspace && selectedSession ? (
          <ThreadView
            activeDialog={activeExtensionDialog}
            displayedSessionTitle={displayedSessionTitle}
            localLabel={t("common.local")}
            rootWorkspace={rootWorkspace}
            runningLabel={runningLabel}
            selectedSession={selectedSession}
            selectedSessionKey={selectedSessionKey}
            selectedWorkspace={selectedWorkspace}
            selectedWorktree={selectedWorktree}
            onRespondToExtensionDialog={handleRespondToExtensionDialog}
            timeline={{
              transcript: activeTranscript,
              isTranscriptLoading,
              timelinePaneRef,
              timelinePaneElementRef: setTimelinePaneElement,
              disableVirtualization: disableTimelineVirtualization,
              onDisableVirtualizationReady: finalizeTimelineVirtualizationDisable,
              onTimelineScroll: handleTimelineScroll,
              threadSearch,
              showJumpToLatest,
              onJumpToLatest: jumpToLatest,
              onContentHeightChange: handleTimelineContentHeightChange,
              onViewFileInDiff: handleViewFileInDiff,
            }}
            composer={{
              activeSlashCommand: slashMenu.activeSlashFlow?.command,
              activeSlashCommandMeta: slashMenu.activeSlashFlow?.command?.description,
              attachments: composerAttachments,
              queuedMessages: queuedComposerMessages,
              editingQueuedMessageId,
              composerDraft,
              composerRef,
              runtime: selectedModelRuntime,
              provider: resolvedSessionProvider,
              modelId: resolvedSessionModelId,
              thinkingLevel: resolvedSessionThinkingLevel,
              onClearSlashCommand: slashMenu.resetSlashUi,
              onComposerKeyDown: handleComposerKeyDown,
              onComposerPaste: handleComposerPaste,
              onComposerDrop: handleComposerDrop,
              onPickAttachments: handlePickAttachments,
              onRemoveAttachment: handleRemoveAttachment,
              onEditQueuedMessage: handleEditQueuedMessage,
              onCancelQueuedEdit: handleCancelQueuedEdit,
              onRemoveQueuedMessage: handleRemoveQueuedMessage,
              onSteerQueuedMessage: handleSteerQueuedMessage,
              onSelectSlashCommand: (command) => {
                slashMenu.applySlashCommandSelection(command, "click");
              },
              onSelectSlashOption: (option) => {
                slashMenu.applySlashOptionSelection(option);
              },
              onSetModel: handleSetSessionModel,
              onSetThinking: handleSetSessionThinking,
              modelOnboarding: selectedSessionModelOnboarding,
              onOpenModelSettings: (section) =>
                openSettings(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id, section),
              onSubmit: submitComposerDraft,
              runningLabel,
              lastError: snapshot.lastError,
              selectedSlashCommand: slashMenu.activeSlashOptionCommand ?? slashMenu.selectedSlashCommand,
              selectedSlashOption: slashMenu.selectedSlashOption,
              slashOptionEmptyState: slashMenu.slashOptionEmptyState,
              setComposerDraft,
              showSlashOptionMenu: slashMenu.showSlashOptionMenu,
              showSlashMenu: slashMenu.showSlashMenu,
              slashOptions: slashMenu.slashOptions,
              slashSections: slashMenu.slashSections,
              showMentionMenu: mentionMenu.showMentionMenu,
              mentionOptions: mentionMenu.mentionOptions,
              selectedMentionIndex: mentionMenu.selectedIndex,
              onSelectMention: mentionMenu.insertMention,
              extensionDock: selectedExtensionDock,
              extensionDockExpanded: isSelectedExtensionDockExpanded,
              onToggleExtensionDock: handleToggleExtensionDock,
            }}
            treeModal={{
              open: treeModalState.open,
              error: treeModalState.error,
              loading: treeModalState.loading,
              submitting: treeModalState.submitting,
              tree: treeModalState.tree,
              onClose: closeTreeModal,
              onNavigate: navigateTreeSelection,
            }}
          />
        ) : selectedWorkspace ? (
          <section className="canvas canvas--empty">
            <div className="empty-panel">
              <div className="session-header__eyebrow">{t("empty.workspaceEyebrow")}</div>
              <h1>{selectedWorkspace.name}</h1>
              <p>{t("empty.workspaceBody")}</p>
              <div className="empty-panel__actions">
                <button
                  className="button button--primary"
                  type="button"
                  onClick={openNewThreadForSelectedWorkspace}
                >
                  {t("sidebar.newThread")}
                </button>
              </div>
            </div>
          </section>
        ) : (
          <section className="canvas canvas--empty">
            <div className="empty-panel">
              <div className="session-header__eyebrow">{t("empty.workspaceEyebrow")}</div>
              <h1>{t("empty.openFolderTitle")}</h1>
              <p>{t("empty.noWorkspaceBody")}</p>
            </div>
          </section>
        )}

        {terminalPanel}
          </>
        )}
        {showDiffPanel && selectedWorkspace && selectedSession ? (
          <DiffPanel
            workspaceId={selectedWorkspace.id}
            sessionId={selectedSession.id}
            api={api}
            sessionStatus={selectedSession.status}
            fileRequest={diffFileRequest}
          />
        ) : null}
      </main>
      {confirmDialog ? (
        <ConfirmDialog
          cancelLabel={confirmDialog.cancelLabel}
          confirmLabel={confirmDialog.confirmLabel}
          message={confirmDialog.message}
          title={confirmDialog.title}
          tone={confirmDialog.tone}
          onCancel={() => closeConfirmDialog(false)}
          onConfirm={() => closeConfirmDialog(true)}
        />
      ) : null}
    </div>
  );
}
