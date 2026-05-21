import { memo, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { AppView, SessionRecord, WorkspaceRecord, WorktreeRecord } from "./desktop-state";
import { ChevronDownIcon, DiffIcon, PlayIcon, TerminalIcon } from "./icons";
import { getDesktopShortcutLabel, type PiDesktopApi } from "./ipc";
import type { WorkspaceMenuState } from "./hooks/use-workspace-menu";
import { useI18n } from "./i18n";
import { getProjectOpenApp, PROJECT_OPEN_APPS, type ProjectOpenAppId } from "./project-open-apps";

interface TopbarProps {
  readonly activeView: AppView;
  readonly rootWorkspace: WorkspaceRecord | undefined;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly selectedSessionTitle: string | undefined;
  readonly selectedWorktree: WorktreeRecord | undefined;
  readonly activeWorktrees: readonly WorktreeRecord[];
  readonly workspaces: readonly WorkspaceRecord[];
  readonly wsMenu: WorkspaceMenuState;
  readonly api: PiDesktopApi;
  readonly lastProjectOpenApp: ProjectOpenAppId;
  readonly projectStartCommand: string;
  readonly terminalAvailable: boolean;
  readonly terminalVisible: boolean;
  readonly onRunProjectStartCommand: (command: string) => Promise<void>;
  readonly onSetProjectStartCommand: (workspaceId: string, command: string) => Promise<void>;
  readonly onToggleTerminal: () => void;
  readonly showDiffPanel: boolean;
  readonly onToggleDiffPanel: () => void;
}

function TopbarComponent(props: TopbarProps) {
  const {
    activeView,
    rootWorkspace,
    selectedWorkspace,
    selectedSession,
    selectedSessionTitle,
    selectedWorktree,
    activeWorktrees,
    workspaces,
    wsMenu,
    api,
    lastProjectOpenApp,
    projectStartCommand,
    terminalAvailable,
    terminalVisible,
    onRunProjectStartCommand,
    onSetProjectStartCommand,
    onToggleTerminal,
    showDiffPanel,
    onToggleDiffPanel,
  } = props;
  const { t } = useI18n();
  const terminalShortcut = getDesktopShortcutLabel(api.platform, "J");
  const diffShortcut = getDesktopShortcutLabel(api.platform, "D");
  const projectRunRef = useRef<HTMLDivElement | null>(null);
  const projectOpenRef = useRef<HTMLDivElement | null>(null);
  const [projectRunMenuOpen, setProjectRunMenuOpen] = useState(false);
  const [projectCommandDraft, setProjectCommandDraft] = useState(projectStartCommand);
  const [projectRunError, setProjectRunError] = useState("");
  const [projectOpenMenuOpen, setProjectOpenMenuOpen] = useState(false);
  const [projectOpenError, setProjectOpenError] = useState("");
  const [projectOpenAppIcons, setProjectOpenAppIcons] = useState<Partial<Record<ProjectOpenAppId, string>>>({});
  const selectedProjectOpenApp = getProjectOpenApp(lastProjectOpenApp);
  const projectOpenDisabled = !selectedWorkspace;
  const projectRunDisabled = !selectedWorkspace || !selectedSession;
  const showEnvironmentPicker = Boolean(selectedWorkspace && activeView === "threads" && activeWorktrees.length > 0);
  const projectRunTitle = projectRunError ||
    (projectStartCommand ? t("topbar.runProjectCommand", { command: projectStartCommand }) : t("topbar.configureProjectStart"));
  const projectOpenTitle = projectOpenError || t("topbar.openProjectIn", { app: selectedProjectOpenApp.label });

  useEffect(() => {
    setProjectCommandDraft(projectStartCommand);
  }, [projectStartCommand, selectedWorkspace?.id]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      PROJECT_OPEN_APPS.map(async (app) => {
        try {
          const iconUrl = await api.getProjectOpenAppIcon(app.id);
          return [app.id, iconUrl] as const;
        } catch {
          return [app.id, null] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) {
        return;
      }

      const nextIcons: Partial<Record<ProjectOpenAppId, string>> = {};
      for (const [appId, iconUrl] of entries) {
        if (iconUrl) {
          nextIcons[appId] = iconUrl;
        }
      }
      setProjectOpenAppIcons(nextIcons);
    });

    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (!projectOpenMenuOpen && !projectRunMenuOpen) {
      return undefined;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        (projectOpenRef.current?.contains(event.target) || projectRunRef.current?.contains(event.target))
      ) {
        return;
      }
      setProjectOpenMenuOpen(false);
      setProjectRunMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProjectOpenMenuOpen(false);
        setProjectRunMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [projectOpenMenuOpen, projectRunMenuOpen]);

  const saveProjectStartCommand = async () => {
    if (!selectedWorkspace) {
      return;
    }
    const normalizedCommand = projectCommandDraft.trim();
    setProjectRunError("");
    try {
      await onSetProjectStartCommand(selectedWorkspace.id, normalizedCommand);
      setProjectRunMenuOpen(false);
    } catch (error) {
      setProjectRunError(error instanceof Error ? error.message : String(error));
    }
  };

  const runProjectStartCommand = async (command: string) => {
    const normalizedCommand = command.trim();
    if (!normalizedCommand) {
      setProjectRunMenuOpen(true);
      return;
    }
    setProjectRunError("");
    setProjectRunMenuOpen(false);
    try {
      if (selectedWorkspace && normalizedCommand !== projectStartCommand) {
        await onSetProjectStartCommand(selectedWorkspace.id, normalizedCommand);
      }
      await onRunProjectStartCommand(normalizedCommand);
    } catch (error) {
      setProjectRunError(error instanceof Error ? error.message : String(error));
      setProjectRunMenuOpen(true);
    }
  };

  const openSelectedWorkspaceInApp = async (appId: ProjectOpenAppId) => {
    if (!selectedWorkspace) {
      return;
    }
    setProjectOpenError("");
    setProjectOpenMenuOpen(false);
    try {
      await api.openWorkspaceInApp(selectedWorkspace.id, appId);
    } catch (error) {
      setProjectOpenError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest(".topbar__actions")) {
      return;
    }

    void api.toggleWindowMaximize();
  };

  return (
    <header className="topbar" data-testid="topbar" onDoubleClick={handleDoubleClick}>
      <div className="topbar__title">
        <span className="topbar__workspace">
          {rootWorkspace ? rootWorkspace.name : t("topbar.openFolderToBegin")}
        </span>
        {showEnvironmentPicker ? (
          <>
            <span className="topbar__separator">/</span>
            <div className="environment-picker" ref={wsMenu.environmentMenuRef}>
              <button
                aria-expanded={wsMenu.environmentMenuOpen}
                aria-haspopup="menu"
                className="environment-picker__button"
                type="button"
                onClick={() => wsMenu.setEnvironmentMenuOpen((current) => !current)}
              >
                {selectedWorkspace?.kind === "worktree" ? selectedWorktree?.name ?? selectedWorkspace.name : t("common.local")}
              </button>
              {wsMenu.environmentMenuOpen && rootWorkspace ? (
                <div className="workspace-menu environment-picker__menu">
                  <button
                    className="workspace-menu__item"
                    type="button"
                    onClick={() => wsMenu.selectWorkspace(rootWorkspace.id)}
                  >
                    {t("common.local")}
                  </button>
                  {activeWorktrees.map((worktree) => {
                    const linkedWorkspace = workspaces.find(
                      (workspace) => workspace.id === worktree.linkedWorkspaceId,
                    );
                    const worktreeSelectable = Boolean(linkedWorkspace) && worktree.status === "ready";
                    return (
                      <button
                        className="workspace-menu__item"
                        key={worktree.id}
                        type="button"
                        disabled={!worktreeSelectable}
                        onClick={() => {
                          if (worktreeSelectable && linkedWorkspace) {
                            wsMenu.selectWorkspace(linkedWorkspace.id);
                          }
                        }}
                      >
                        {worktree.name}
                        {!worktreeSelectable ? ` (${worktree.status !== "ready" ? worktree.status : "unavailable"})` : ""}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </>
        ) : null}
        {selectedWorkspace && activeView === "threads" && selectedSession ? (
          <>
            <span className="topbar__separator">/</span>
            <span className="topbar__session">{selectedSessionTitle ?? selectedSession.title}</span>
          </>
        ) : activeView === "new-thread" && rootWorkspace ? (
          <>
            <span className="topbar__separator">/</span>
            <span className="topbar__session">{t("sidebar.newThread")}</span>
          </>
        ) : null}
      </div>

      <div className="topbar__actions">
        <div className="project-action" ref={projectRunRef}>
          <div className="project-action__control">
            <button
              aria-label={projectRunTitle}
              className="icon-button topbar__icon project-action__primary"
              disabled={projectRunDisabled}
              title={projectRunTitle}
              type="button"
              onClick={() => void runProjectStartCommand(projectStartCommand)}
            >
              <PlayIcon />
            </button>
            <button
              aria-expanded={projectRunMenuOpen}
              aria-haspopup="dialog"
              aria-label={t("topbar.configureProjectStart")}
              className="icon-button topbar__icon project-action__chevron"
              disabled={projectRunDisabled}
              title={t("topbar.configureProjectStart")}
              type="button"
              onClick={() => {
                setProjectRunMenuOpen((current) => !current);
                setProjectOpenMenuOpen(false);
              }}
            >
              <ChevronDownIcon />
            </button>
          </div>
          {projectRunMenuOpen ? (
            <form
              className="project-action__menu project-action__menu--command"
              onSubmit={(event) => {
                event.preventDefault();
                void runProjectStartCommand(projectCommandDraft);
              }}
            >
              <label className="project-action__label" htmlFor="project-start-command">
                {t("topbar.startCommand")}
              </label>
              <input
                className="project-action__input"
                id="project-start-command"
                placeholder="pnpm dev"
                value={projectCommandDraft}
                onChange={(event) => setProjectCommandDraft(event.currentTarget.value)}
              />
              {projectRunError ? <div className="project-action__error">{projectRunError}</div> : null}
              <div className="project-action__menu-actions">
                <button className="project-action__text-button" type="button" onClick={() => void saveProjectStartCommand()}>
                  {t("topbar.save")}
                </button>
                <button className="project-action__text-button project-action__text-button--primary" type="submit">
                  {t("topbar.run")}
                </button>
              </div>
            </form>
          ) : null}
        </div>
        <div className="project-action" ref={projectOpenRef}>
          <div className="project-action__control">
            <button
              aria-label={projectOpenTitle}
              className="icon-button topbar__icon project-action__primary project-action__primary--app"
              disabled={projectOpenDisabled}
              title={projectOpenTitle}
              type="button"
              onClick={() => void openSelectedWorkspaceInApp(selectedProjectOpenApp.id)}
            >
              <ProjectOpenAppIcon appId={selectedProjectOpenApp.id} iconUrl={projectOpenAppIcons[selectedProjectOpenApp.id]} />
            </button>
            <button
              aria-expanded={projectOpenMenuOpen}
              aria-haspopup="menu"
              aria-label={t("topbar.chooseProjectOpener")}
              className="icon-button topbar__icon project-action__chevron"
              disabled={projectOpenDisabled}
              title={t("topbar.chooseProjectOpener")}
              type="button"
              onClick={() => {
                setProjectOpenMenuOpen((current) => !current);
                setProjectRunMenuOpen(false);
              }}
            >
              <ChevronDownIcon />
            </button>
          </div>
          {projectOpenMenuOpen ? (
            <div className="project-action__menu project-action__menu--apps" role="menu">
              {PROJECT_OPEN_APPS.map((app) => (
                <button
                  className={`project-action__item${app.id === lastProjectOpenApp ? " project-action__item--active" : ""}`}
                  key={app.id}
                  role="menuitem"
                  type="button"
                  onClick={() => void openSelectedWorkspaceInApp(app.id)}
                >
                  <ProjectOpenAppIcon appId={app.id} iconUrl={projectOpenAppIcons[app.id]} />
                  <span>{app.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="shortcut-tooltip-wrap topbar__tooltip-wrap">
          <button
            aria-label={t("topbar.toggleTerminal")}
            className={`icon-button topbar__icon ${terminalVisible ? "icon-button--active" : ""}`}
            type="button"
            disabled={!terminalAvailable}
            onClick={onToggleTerminal}
          >
            <TerminalIcon />
          </button>
          <span className="shortcut-tooltip topbar__tooltip" role="tooltip">
            <span>{t("topbar.toggleTerminal")}</span>
            <kbd>{terminalShortcut}</kbd>
          </span>
        </div>
        <div className="shortcut-tooltip-wrap topbar__tooltip-wrap">
          <button
            aria-label={t("topbar.toggleChanges")}
            className={`icon-button topbar__icon ${showDiffPanel ? "icon-button--active" : ""}`}
            type="button"
            onClick={onToggleDiffPanel}
          >
            <DiffIcon />
          </button>
          <span className="shortcut-tooltip topbar__tooltip" role="tooltip">
            <span>{t("topbar.toggleChanges")}</span>
            <kbd>{diffShortcut}</kbd>
          </span>
        </div>
      </div>
    </header>
  );
}

export const Topbar = memo(TopbarComponent);

function ProjectOpenAppIcon({ appId, iconUrl }: { readonly appId: ProjectOpenAppId; readonly iconUrl?: string }) {
  if (iconUrl) {
    return (
      <span className={`project-action__app-icon project-action__app-icon--native project-action__app-icon--${appId}`} aria-hidden="true">
        <img src={iconUrl} alt="" />
      </span>
    );
  }

  const label = appId === "vscode"
    ? "V"
    : appId === "cursor"
      ? "C"
      : appId === "finder"
        ? "F"
        : appId === "terminal"
          ? ">"
          : appId === "ghostty"
            ? "G"
            : "X";
  return (
    <span className={`project-action__app-icon project-action__app-icon--${appId}`} aria-hidden="true">
      {label}
    </span>
  );
}
