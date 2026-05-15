import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PiDesktopApi } from "./ipc";
import { InlineDiff } from "./diff-inline";
import { ChevronDownIcon, ChevronRightIcon, MinusIcon, PlusIcon, RefreshIcon, SparkIcon } from "./icons";
import { extensionToLanguage } from "./syntax-highlight";
import { loadReviewed, pruneReviewed, saveReviewed } from "./reviewed-files-store";
import { useI18n } from "./i18n";

interface ChangedFile {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted" | "untracked";
  readonly staged: boolean;
  readonly unstaged: boolean;
  readonly indexStatus: string;
  readonly worktreeStatus: string;
}

interface CommitHistoryEntry {
  readonly hash: string;
  readonly subject: string;
  readonly author: string;
  readonly relativeTime: string;
  readonly refs: readonly string[];
}

type ChangeGroup = "staged" | "unstaged";
const CHANGE_REFRESH_INTERVAL_MS = 2500;

export interface DiffPanelFileRequest {
  readonly path: string;
  readonly nonce: number;
}

interface DiffPanelProps {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly api: PiDesktopApi;
  readonly sessionStatus: string | undefined;
  readonly fileRequest?: DiffPanelFileRequest | null;
}

export function DiffPanel({
  workspaceId,
  sessionId,
  api,
  sessionStatus,
  fileRequest,
}: DiffPanelProps) {
  const { t } = useI18n();
  const [files, setFiles] = useState<readonly ChangedFile[]>([]);
  const [commitHistory, setCommitHistory] = useState<readonly CommitHistoryEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<{ readonly path: string; readonly group: ChangeGroup } | null>(null);
  const [diffText, setDiffText] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [loading, setLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [commitBusy, setCommitBusy] = useState(false);
  const [generatingMessage, setGeneratingMessage] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<ChangeGroup>>(
    () => new Set(["staged", "unstaged"]),
  );
  const [reviewed, setReviewed] = useState<ReadonlySet<string>>(() =>
    loadReviewed(workspaceId, sessionId),
  );

  useEffect(() => {
    setReviewed(loadReviewed(workspaceId, sessionId));
  }, [workspaceId, sessionId]);

  const refresh = useCallback(() => {
    setLoading(true);
    setErrorMessage("");
    void Promise.all([
      api.getChangedFiles(workspaceId),
      api.getCommitHistory(workspaceId),
    ]).then(([result, history]) => {
      setFiles(result);
      setCommitHistory(history);
      setRefreshNonce((value) => value + 1);
      setSelectedFile((current) =>
        current && !result.some((f) => f.path === current.path && (current.group === "staged" ? f.staged : f.unstaged)) ? null : current,
      );
      setReviewed((current) => {
        const pruned = pruneReviewed(current, result.map((f) => f.path));
        if (pruned !== current) {
          saveReviewed(workspaceId, sessionId, pruned);
        }
        return pruned;
      });
      setLoading(false);
    }).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : t("changes.errorRefresh"));
      setLoading(false);
    });
  }, [api, workspaceId, sessionId, t]);

  const prevStatusRef = useRef(sessionStatus);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = sessionStatus;
    if (prev === "running" && sessionStatus !== "running") {
      refresh();
    }
  }, [sessionStatus, refresh]);

  useEffect(() => {
    refresh();
  }, [workspaceId, sessionId]);

  useEffect(() => {
    const interval = window.setInterval(refresh, CHANGE_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (!fileRequest) return;
    setSelectedFile({ path: fileRequest.path, group: "unstaged" });
  }, [fileRequest]);

  useEffect(() => {
    if (!selectedFile) {
      setDiffText("");
      return;
    }
    void api.getFileDiff(workspaceId, selectedFile.path, selectedFile.group === "staged").then(setDiffText);
  }, [api, workspaceId, selectedFile, refreshNonce]);

  const fileListRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!selectedFile) return;
    const row = fileListRef.current?.querySelector<HTMLElement>(
      `[data-file-path="${CSS.escape(selectedFile.path)}"][data-change-group="${selectedFile.group}"]`,
    );
    row?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [selectedFile, files]);

  const handleStage = (filePath: string) => {
    setErrorMessage("");
    void api.stageFile(workspaceId, filePath).then(refresh).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : t("changes.errorStageFile"));
    });
  };

  const handleUnstage = (filePath: string) => {
    setErrorMessage("");
    void api.unstageFile(workspaceId, filePath).then(refresh).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : t("changes.errorUnstageFile"));
    });
  };

  const handleStageAll = () => {
    setErrorMessage("");
    void api.stageAllFiles(workspaceId).then(refresh).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : t("changes.errorStageAll"));
    });
  };

  const handleUnstageAll = () => {
    setErrorMessage("");
    void api.unstageAllFiles(workspaceId).then(refresh).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : t("changes.errorUnstageAll"));
    });
  };

  const handleGenerateMessage = () => {
    setGeneratingMessage(true);
    setErrorMessage("");
    void api.generateCommitMessage(workspaceId, sessionId).then((message) => {
      if (message.trim()) {
        setCommitMessage(message);
      }
      setGeneratingMessage(false);
    }).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : t("changes.errorGenerateMessage"));
      setGeneratingMessage(false);
    });
  };

  const handleCommit = () => {
    const message = commitMessage.trim();
    if (!message) return;
    setCommitBusy(true);
    setErrorMessage("");
    void api.commitStagedChanges(workspaceId, message).then(() => {
      setCommitMessage("");
      setCommitBusy(false);
      refresh();
    }).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : t("changes.errorCommit"));
      setCommitBusy(false);
    });
  };

  const toggleGroup = (group: ChangeGroup) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  };

  const toggleReviewed = useCallback(
    (filePath: string) => {
      setReviewed((current) => {
        const next = new Set(current);
        if (next.has(filePath)) {
          next.delete(filePath);
        } else {
          next.add(filePath);
        }
        saveReviewed(workspaceId, sessionId, next);
        return next;
      });
    },
    [workspaceId, sessionId],
  );

  const reviewedCount = useMemo(
    () => files.reduce((acc, f) => acc + (reviewed.has(f.path) ? 1 : 0), 0),
    [files, reviewed],
  );
  const stagedFiles = useMemo(() => files.filter((file) => file.staged), [files]);
  const unstagedFiles = useMemo(() => files.filter((file) => file.unstaged), [files]);
  const hasStagedFiles = stagedFiles.length > 0;
  const canCommit = hasStagedFiles && commitMessage.trim().length > 0 && !commitBusy;

  return (
    <aside className="diff-panel">
      <div className="diff-panel__header">
        <h2 className="diff-panel__title">{t("changes.title")}</h2>
        {files.length > 0 ? (
          <span className="diff-panel__counter" data-testid="diff-panel-counter">
            {t("changes.reviewedCount", { reviewed: reviewedCount, total: files.length })}
          </span>
        ) : null}
        <button
          className="icon-button"
          type="button"
          onClick={refresh}
          aria-label={t("changes.refresh")}
          disabled={loading}
        >
          <RefreshIcon />
        </button>
      </div>

      <div className="diff-panel__commit">
        <div className="diff-panel__commit-input-row">
          <input
            aria-label="Commit message"
            className="diff-panel__commit-input"
            placeholder={t("changes.commitPlaceholder")}
            type="text"
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canCommit) {
                handleCommit();
              }
            }}
          />
          <button
            aria-label={t("changes.generateCommitMessage")}
            className="icon-button diff-panel__generate-btn"
            type="button"
            onClick={handleGenerateMessage}
            disabled={!hasStagedFiles || generatingMessage}
          >
            <SparkIcon />
          </button>
        </div>
        <button
          className="diff-panel__commit-btn"
          type="button"
          onClick={handleCommit}
          disabled={!canCommit}
        >
          {commitBusy ? t("changes.committing") : t("changes.commit")}
        </button>
        {errorMessage ? <div className="diff-panel__error">{errorMessage}</div> : null}
      </div>

      <div className="diff-panel__body">
        {files.length === 0 ? (
          <div className="diff-panel__empty">{t("changes.noChanges")}</div>
        ) : (
          <>
            <div className="diff-panel__file-list" ref={fileListRef}>
              <ChangeSection
                actionLabel={t("changes.unstageAll")}
                files={stagedFiles}
                group="staged"
                isExpanded={expandedGroups.has("staged")}
                onActionAll={handleUnstageAll}
                onFileAction={handleUnstage}
                onSelectFile={setSelectedFile}
                onToggle={() => toggleGroup("staged")}
                reviewed={reviewed}
                selectedFile={selectedFile}
                title={t("changes.stagedChanges")}
                toggleReviewed={toggleReviewed}
              />
              <ChangeSection
                actionLabel={t("changes.stageAll")}
                files={unstagedFiles}
                group="unstaged"
                isExpanded={expandedGroups.has("unstaged")}
                onActionAll={handleStageAll}
                onFileAction={handleStage}
                onSelectFile={setSelectedFile}
                onToggle={() => toggleGroup("unstaged")}
                reviewed={reviewed}
                selectedFile={selectedFile}
                title={t("changes.unstagedChanges")}
                toggleReviewed={toggleReviewed}
              />
            </div>

            {selectedFile && diffText ? (
              <div className="diff-panel__viewer">
                <div className="diff-panel__viewer-header">{selectedFile.path}</div>
                <InlineDiff diff={diffText} language={extensionToLanguage(selectedFile.path)} />
              </div>
            ) : null}
          </>
        )}
        <CommitHistory history={commitHistory} />
      </div>
    </aside>
  );
}

interface ChangeSectionProps {
  readonly actionLabel: string;
  readonly files: readonly ChangedFile[];
  readonly group: ChangeGroup;
  readonly isExpanded: boolean;
  readonly onActionAll: () => void;
  readonly onFileAction: (filePath: string) => void;
  readonly onSelectFile: (file: { readonly path: string; readonly group: ChangeGroup } | null) => void;
  readonly onToggle: () => void;
  readonly reviewed: ReadonlySet<string>;
  readonly selectedFile: { readonly path: string; readonly group: ChangeGroup } | null;
  readonly title: string;
  readonly toggleReviewed: (filePath: string) => void;
}

function ChangeSection({
  actionLabel,
  files,
  group,
  isExpanded,
  onActionAll,
  onFileAction,
  onSelectFile,
  onToggle,
  reviewed,
  selectedFile,
  title,
  toggleReviewed,
}: ChangeSectionProps) {
  const { t } = useI18n();
  return (
    <section className="diff-panel__section">
      <div className="diff-panel__section-header">
        <button
          aria-expanded={isExpanded}
          className="diff-panel__section-toggle"
          type="button"
          onClick={onToggle}
        >
          {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
          <span>{title}</span>
          <span className="diff-panel__section-count">{files.length}</span>
        </button>
        <button
          className="diff-panel__section-action"
          type="button"
          onClick={onActionAll}
          disabled={files.length === 0}
        >
          {actionLabel}
        </button>
      </div>
      {isExpanded ? (
        files.length === 0 ? (
          <div className="diff-panel__section-empty">{t("changes.noFiles")}</div>
        ) : (
          files.map((file) => {
            const isReviewed = reviewed.has(file.path);
            const isSelected = selectedFile?.path === file.path && selectedFile.group === group;
            const className = [
              "diff-panel__file",
              isSelected ? "diff-panel__file--selected" : "",
              isReviewed ? "diff-panel__file--reviewed" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <div className={className} key={`${group}:${file.path}`} data-file-path={file.path} data-change-group={group}>
                <input
                  aria-label={`Mark ${file.path} reviewed`}
                  className="diff-panel__reviewed-checkbox"
                  data-testid={`diff-panel-reviewed-${file.path}`}
                  type="checkbox"
                  checked={isReviewed}
                  onChange={() => toggleReviewed(file.path)}
                />
                <button
                  className="diff-panel__file-name"
                  type="button"
                  onClick={() => onSelectFile(isSelected ? null : { path: file.path, group })}
                >
                  <span className={`diff-panel__status-dot diff-panel__status-dot--${file.status}`} />
                  <span>{file.path}</span>
                </button>
                <button
                  aria-label={`${group === "staged" ? t("changes.unstage") : t("changes.stage")} ${file.path}`}
                  className="diff-panel__stage-btn"
                  type="button"
                  onClick={() => onFileAction(file.path)}
                >
                  {group === "staged" ? <MinusIcon /> : <PlusIcon />}
                </button>
              </div>
            );
          })
        )
      ) : null}
    </section>
  );
}

function CommitHistory({ history }: { readonly history: readonly CommitHistoryEntry[] }) {
  const { t } = useI18n();
  return (
    <section className="diff-panel__history" aria-label={t("changes.commitHistory")}>
      <div className="diff-panel__history-header">
        <span>{t("changes.commitHistory")}</span>
        <span className="diff-panel__section-count">{history.length}</span>
      </div>
      {history.length === 0 ? (
        <div className="diff-panel__section-empty">{t("changes.noCommitHistory")}</div>
      ) : (
        <div className="diff-panel__history-list">
          {history.map((commit) => (
            <div className="diff-panel__history-item" key={commit.hash}>
              <span className="diff-panel__history-dot" />
              <div className="diff-panel__history-body">
                <div className="diff-panel__history-subject">
                  <span>{commit.subject}</span>
                  {commit.refs.length > 0 ? <span className="diff-panel__history-ref">{commit.refs[0]}</span> : null}
                </div>
                <div className="diff-panel__history-meta">
                  <span>{commit.hash}</span>
                  <span>{commit.author}</span>
                  <span>{commit.relativeTime}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
