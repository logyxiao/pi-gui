import type { HostUiResponse } from "@pi-gui/session-driver";
import type { ModelOnboardingSettingsSection } from "./model-onboarding";
import type {
  SessionExtensionDialogRecord,
  SessionRecord,
  WorkspaceRecord,
  WorktreeRecord,
} from "./desktop-state";
import { formatRelativeTime } from "./string-utils";
import { ComposerPanel, type ComposerPanelProps } from "./composer-panel";
import {
  ConversationTimeline,
  type ConversationTimelineProps,
  type ThreadSearchModel,
} from "./conversation-timeline";
import { ExtensionDialog, type ExtensionDockModel } from "./extension-session-ui";
import { TreeModal, type TreeModalProps } from "./tree-modal";

interface ThreadTimelineProps extends Pick<
  ConversationTimelineProps,
  | "disableVirtualization"
  | "isTranscriptLoading"
  | "onContentHeightChange"
  | "onDisableVirtualizationReady"
  | "onJumpToLatest"
  | "onTimelineScroll"
  | "onViewFileInDiff"
  | "showJumpToLatest"
  | "timelinePaneElementRef"
  | "timelinePaneRef"
  | "transcript"
> {
  readonly threadSearch: ThreadSearchModel;
}

interface ThreadComposerProps extends Omit<
  ComposerPanelProps,
  | "contextUsage"
  | "editingQueuedMessageId"
  | "extensionDock"
  | "extensionDockExpanded"
  | "modelId"
  | "modelOnboarding"
  | "onOpenModelSettings"
  | "onSetModel"
  | "onSetThinking"
  | "onToggleExtensionDock"
  | "provider"
  | "queuedMessages"
  | "runtime"
  | "selectedSession"
  | "thinkingLevel"
> {
  readonly editingQueuedMessageId?: string;
  readonly extensionDock?: ExtensionDockModel;
  readonly extensionDockExpanded: boolean;
  readonly modelId: string | undefined;
  readonly modelOnboarding: ComposerPanelProps["modelOnboarding"];
  readonly onOpenModelSettings: (section: ModelOnboardingSettingsSection) => void;
  readonly onSetModel: (provider: string, modelId: string) => void;
  readonly onSetThinking: (level: string) => void;
  readonly onToggleExtensionDock: () => void;
  readonly provider: string | undefined;
  readonly queuedMessages: ComposerPanelProps["queuedMessages"];
  readonly runtime: ComposerPanelProps["runtime"];
  readonly thinkingLevel: string | undefined;
}

interface ThreadViewProps {
  readonly activeDialog?: SessionExtensionDialogRecord;
  readonly composer: ThreadComposerProps;
  readonly displayedSessionTitle: string;
  readonly rootWorkspace: WorkspaceRecord | undefined;
  readonly runningLabel: string;
  readonly selectedSession: SessionRecord;
  readonly selectedSessionKey: string;
  readonly selectedWorkspace: WorkspaceRecord;
  readonly selectedWorktree: WorktreeRecord | undefined;
  readonly timeline: ThreadTimelineProps;
  readonly treeModal: Pick<TreeModalProps, "error" | "loading" | "onClose" | "onNavigate" | "submitting" | "tree"> & {
    readonly open: boolean;
  };
  readonly onRespondToExtensionDialog: (response: HostUiResponse) => void;
  readonly localLabel: string;
}

export function ThreadView({
  activeDialog,
  composer,
  displayedSessionTitle,
  rootWorkspace,
  runningLabel,
  selectedSession,
  selectedSessionKey,
  selectedWorkspace,
  selectedWorktree,
  timeline,
  treeModal,
  onRespondToExtensionDialog,
  localLabel,
}: ThreadViewProps) {
  const environmentLabel = selectedWorkspace.kind === "worktree"
    ? `${rootWorkspace?.name ?? selectedWorkspace.name} · ${selectedWorktree?.name ?? selectedWorkspace.branchName ?? "Worktree"}`
    : `${selectedWorkspace.name} · ${localLabel}`;

  return (
    <>
      <section className="canvas canvas--thread">
        <div className="conversation conversation--thread">
          <div className="chat-header">
            <div className="chat-header__eyebrow">{environmentLabel}</div>
            <div className="chat-header__row">
              <h1 className="chat-header__title">{displayedSessionTitle}</h1>
              <div className="chat-header__status">
                {selectedSession.status === "running" ? runningLabel : formatRelativeTime(selectedSession.updatedAt)}
              </div>
            </div>
          </div>

          <ConversationTimeline {...timeline} />
        </div>
      </section>
      <ComposerPanel
        key={selectedSessionKey}
        {...composer}
        contextUsage={selectedSession.contextUsage}
        selectedSession={selectedSession}
      />
      {activeDialog ? (
        <ExtensionDialog dialog={activeDialog} onRespond={onRespondToExtensionDialog} />
      ) : null}
      {treeModal.open ? (
        <TreeModal
          error={treeModal.error}
          loading={treeModal.loading}
          submitting={treeModal.submitting}
          tree={treeModal.tree}
          onClose={treeModal.onClose}
          onNavigate={treeModal.onNavigate}
        />
      ) : null}
    </>
  );
}
