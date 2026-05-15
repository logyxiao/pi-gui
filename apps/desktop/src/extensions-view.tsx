import { useMemo, useState } from "react";
import type { RuntimeExtensionRecord, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ExtensionCommandCompatibilityRecord, WorkspaceRecord } from "./desktop-state";
import { RefreshIcon } from "./icons";
import { useI18n } from "./i18n";

interface ExtensionsViewProps {
  readonly workspace?: WorkspaceRecord;
  readonly runtime?: RuntimeSnapshot;
  readonly commandCompatibility?: readonly ExtensionCommandCompatibilityRecord[];
  readonly onRefresh: () => void;
  readonly onOpenExtensionFolder: (filePath: string) => void;
  readonly onToggleExtension: (filePath: string, enabled: boolean) => void;
  readonly embedded?: boolean;
}

export function ExtensionsView({
  workspace,
  runtime,
  commandCompatibility = [],
  onRefresh,
  onOpenExtensionFolder,
  onToggleExtension,
  embedded = false,
}: ExtensionsViewProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [selectedExtensionPath, setSelectedExtensionPath] = useState<string | undefined>();
  const extensions = runtime?.extensions ?? [];
  const filteredExtensions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return extensions;
    }

    return extensions.filter((extension) =>
      [
        extension.displayName,
        extension.path,
        extension.sourceInfo.source,
        extension.sourceInfo.scope,
        extension.sourceInfo.origin,
        ...extension.commands,
        ...extension.tools,
        ...extension.flags,
        ...extension.shortcuts,
        ...extension.diagnostics.map((diagnostic) => diagnostic.message),
      ].some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [extensions, query]);
  const selectedExtension =
    filteredExtensions.find((extension) => extension.path === selectedExtensionPath) ?? filteredExtensions[0];
  const selectedCompatibilityRecords = useMemo(
    () =>
      selectedExtension
        ? commandCompatibility
            .filter((record) => record.extensionPath === selectedExtension.path)
            .sort((left, right) => left.commandName.localeCompare(right.commandName))
        : [],
    [commandCompatibility, selectedExtension],
  );

  if (!workspace) {
    return (
      <section className="canvas canvas--empty">
        <div className="empty-panel">
          <div className="session-header__eyebrow">{t("settings.extensions.title")}</div>
          <h1>{t("settings.extensions.selectWorkspaceTitle")}</h1>
          <p>{t("settings.extensions.selectWorkspaceBody")}</p>
        </div>
      </section>
    );
  }

  const content = (
    <div className={`skills-view ${embedded ? "skills-view--embedded" : "conversation"}`}>
      {!embedded ? (
        <header className="view-header">
          <div>
            <div className="chat-header__eyebrow">{t("settings.extensions.title")}</div>
            <h1 className="view-header__title">{t("settings.extensions.title")}</h1>
            <p className="view-header__body">{t("settings.extensions.body")}</p>
          </div>
        </header>
      ) : null}

      <div className="settings-group settings-catalog">
        <div className="settings-catalog__toolbar">
          <input
            aria-label={t("settings.extensions.search")}
            className="settings-search model-manager__filter settings-catalog__search"
            placeholder={t("settings.extensions.search")}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
          <div className="settings-row__actions settings-catalog__toolbar-actions">
            <button className="button button--secondary model-manager__strong-button" type="button" onClick={onRefresh}>
              <RefreshIcon />
              <span>{t("settings.catalog.refresh")}</span>
            </button>
          </div>
        </div>

        <div className="settings-catalog__body">
          <aside className="settings-catalog__rail" aria-label={t("settings.extensions.title")}>
            <div className="model-manager__rail-head">
              <div>
                <div className="model-manager__section-label">{t("settings.extensions.title")}</div>
                <strong>{extensions.length}</strong>
              </div>
              {query ? <span className="settings-catalog__result-count">{t("settings.catalog.shown", { count: filteredExtensions.length })}</span> : null}
            </div>
            <div className="settings-catalog__list" data-testid="extensions-list">
              {filteredExtensions.length === 0 ? (
                <ExtensionsEmptyState title={t("settings.extensions.empty")} message={t("settings.extensions.emptyBody")} />
              ) : (
                filteredExtensions.map((extension) => (
                  <button
                    className={`settings-catalog__item ${selectedExtension?.path === extension.path ? "settings-catalog__item--active" : ""}`}
                    key={extension.path}
                    type="button"
                    onClick={() => {
                      setSelectedExtensionPath(extension.path);
                    }}
                  >
                    <span className="settings-catalog__item-copy">
                      <span className="settings-catalog__item-title">{extension.displayName}</span>
                      <span className="settings-catalog__item-description">
                        {extension.sourceInfo.scope} · {extension.sourceInfo.origin}
                      </span>
                      <span className="settings-catalog__item-meta">
                        <span>{extension.sourceInfo.source}</span>
                        {extension.commands.length > 0 ? <span>{t("settings.extensions.commandsCount", { count: extension.commands.length })}</span> : null}
                        {extension.tools.length > 0 ? <span>{t("settings.extensions.toolsCount", { count: extension.tools.length })}</span> : null}
                        {extension.diagnostics.length > 0 ? <span>{t("settings.extensions.issuesCount", { count: extension.diagnostics.length })}</span> : null}
                      </span>
                    </span>
                    <span className={`settings-catalog__badge ${extension.enabled ? "settings-catalog__badge--enabled" : ""}`}>
                      {extension.enabled ? t("settings.catalog.enabled") : t("settings.catalog.disabled")}
                    </span>
                  </button>
                ))
              )}
            </div>
          </aside>

          <section className="settings-catalog__detail" aria-label="Extension details">
            {selectedExtension ? (
              <>
                <div className="settings-catalog__detail-head">
                  <div className="settings-catalog__detail-title-block">
                    <div className="model-manager__section-label">{t("settings.extensions.selected")}</div>
                    <h2>{selectedExtension.displayName}</h2>
                    <div className="settings-catalog__mono">{selectedExtension.sourceInfo.source}</div>
                  </div>
                  <span className={`settings-catalog__badge settings-catalog__detail-status ${selectedExtension.enabled ? "settings-catalog__badge--enabled" : ""}`}>
                    {selectedExtension.enabled ? t("settings.catalog.enabled") : t("settings.catalog.disabled")}
                  </span>
                </div>
                <div className="settings-catalog__meta-grid">
                  <DetailItem label={t("settings.catalog.scope")} value={selectedExtension.sourceInfo.scope} />
                  <DetailItem label={t("settings.catalog.origin")} value={selectedExtension.sourceInfo.origin} />
                  <DetailItem label={t("settings.catalog.path")} value={selectedExtension.path} mono wide />
                  {selectedExtension.sourceInfo.baseDir ? (
                    <DetailItem label={t("settings.catalog.baseDir")} value={selectedExtension.sourceInfo.baseDir} mono wide />
                  ) : null}
                </div>
                <div className="settings-catalog__detail-actions">
                  <button className="button button--secondary model-manager__strong-button" type="button" onClick={() => onOpenExtensionFolder(selectedExtension.path)}>
                    {t("settings.catalog.openFolder")}
                  </button>
                  <button
                    className="button button--secondary model-manager__strong-button"
                    type="button"
                    onClick={() => onToggleExtension(selectedExtension.path, !selectedExtension.enabled)}
                  >
                    {selectedExtension.enabled ? t("settings.catalog.disable") : t("settings.catalog.enable")}
                  </button>
                </div>

                <ExtensionContributionSection title={t("settings.extensions.commands")} items={selectedExtension.commands} emptyLabel={t("settings.extensions.noCommands")} />
                <ExtensionCompatibilitySection
                  commands={selectedExtension.commands}
                  compatibilityRecords={selectedCompatibilityRecords}
                />
                <ExtensionContributionSection title={t("settings.extensions.tools")} items={selectedExtension.tools} emptyLabel={t("settings.extensions.noTools")} />
                <ExtensionContributionSection title={t("settings.extensions.flags")} items={selectedExtension.flags} emptyLabel={t("settings.extensions.noFlags")} />
                <ExtensionContributionSection title={t("settings.extensions.shortcuts")} items={selectedExtension.shortcuts} emptyLabel={t("settings.extensions.noShortcuts")} />
                <ExtensionDiagnostics diagnostics={selectedExtension.diagnostics} />
              </>
            ) : (
              <ExtensionsEmptyState title={t("settings.extensions.empty")} message={t("settings.extensions.emptyInspect")} />
            )}
          </section>
        </div>
      </div>
    </div>
  );

  if (embedded) {
    return content;
  }

  return <section className="canvas">{content}</section>;
}

function DetailItem({
  label,
  value,
  mono,
  wide,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
  readonly wide?: boolean;
}) {
  return (
    <div className={wide ? "settings-catalog__meta-item settings-catalog__meta-item--wide" : "settings-catalog__meta-item"}>
      <div className="settings-catalog__meta-label">{label}</div>
      <div className={mono ? "settings-catalog__mono" : "settings-catalog__meta-value"}>{value}</div>
    </div>
  );
}

function ExtensionContributionSection({
  title,
  items,
  emptyLabel,
}: {
  readonly title: string;
  readonly items: readonly string[];
  readonly emptyLabel: string;
}) {
  return (
    <section className="settings-catalog__subsection">
      <div className="settings-catalog__meta-label">{title}</div>
      {items.length > 0 ? (
        <div className="extension-detail__tokens">
          {items.map((item) => (
            <span className="slash-menu__skill-badge" key={item}>
              {item}
            </span>
          ))}
        </div>
      ) : (
        <div className="settings-catalog__meta-value">{emptyLabel}</div>
      )}
    </section>
  );
}

function ExtensionDiagnostics({
  diagnostics,
}: {
  readonly diagnostics: RuntimeExtensionRecord["diagnostics"];
}) {
  const { t } = useI18n();
  return (
    <section className="settings-catalog__subsection">
      <div className="settings-catalog__meta-label">{t("settings.extensions.diagnostics")}</div>
      {diagnostics.length > 0 ? (
        <div className="extension-detail__diagnostics">
          {diagnostics.map((diagnostic, index) => (
            <div className={`activity-item activity-item--${diagnostic.type === "error" ? "error" : "info"}`} key={`${diagnostic.message}:${index}`}>
              <div className="activity-item__text">{diagnostic.message}</div>
              {diagnostic.path ? <div className="activity-item__meta">{diagnostic.path}</div> : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="settings-catalog__meta-value">{t("settings.extensions.noDiagnostics")}</div>
      )}
    </section>
  );
}

function ExtensionCompatibilitySection({
  commands,
  compatibilityRecords,
}: {
  readonly commands: readonly string[];
  readonly compatibilityRecords: readonly ExtensionCommandCompatibilityRecord[];
}) {
  const { t } = useI18n();
  const supported = compatibilityRecords.filter((record) => record.status === "supported");
  const terminalOnly = compatibilityRecords.filter((record) => record.status === "terminal-only");
  const unknown = commands.filter((commandName) =>
    compatibilityRecords.every(
      (record) => record.commandName !== commandName && !record.commandName.startsWith(`${commandName}:`),
    ),
  );

  return (
    <section className="settings-catalog__subsection">
      <div className="settings-catalog__meta-label">{t("settings.extensions.commandCompatibility")}</div>
      <div className="settings-catalog__meta-value">{t("settings.extensions.compatibilityDescription")}</div>
      <div className="extension-detail__tokens">
        {supported.map((record) => (
          <span className="slash-menu__skill-badge" key={`supported:${record.commandName}`}>
            {record.commandName} · {t("settings.extensions.guiCompatible")}
          </span>
        ))}
        {terminalOnly.map((record) => (
          <span className="slash-menu__skill-badge slash-menu__skill-badge--warning" key={`terminal:${record.commandName}`}>
            {record.commandName} · {t("settings.extensions.terminalOnly")}
          </span>
        ))}
        {unknown.map((commandName) => (
          <span className="slash-menu__skill-badge" key={`unknown:${commandName}`}>
            {commandName} · {t("settings.extensions.unknown")}
          </span>
        ))}
      </div>
    </section>
  );
}

function ExtensionsEmptyState({ title, message }: { readonly title: string; readonly message: string }) {
  return (
    <div className="settings-catalog__empty">
      <h2>{title}</h2>
      <p>{message}</p>
    </div>
  );
}
