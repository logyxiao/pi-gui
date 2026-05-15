import { useMemo, useState } from "react";
import type { RuntimeSkillRecord, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { WorkspaceRecord } from "./desktop-state";
import { RefreshIcon } from "./icons";
import { useI18n } from "./i18n";
import { titleCase } from "./string-utils";

interface SkillsViewProps {
  readonly workspace?: WorkspaceRecord;
  readonly runtime?: RuntimeSnapshot;
  readonly onRefresh: () => void;
  readonly onOpenSkillFolder: (filePath: string) => void;
  readonly onToggleSkill: (filePath: string, enabled: boolean) => void;
  readonly onTrySkill: (skill: RuntimeSkillRecord) => void;
  readonly embedded?: boolean;
}

export function SkillsView({
  workspace,
  runtime,
  onRefresh,
  onOpenSkillFolder,
  onToggleSkill,
  onTrySkill,
  embedded = false,
}: SkillsViewProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [selectedSkillPath, setSelectedSkillPath] = useState<string | undefined>();
  const skills = runtime?.skills ?? [];
  const filteredSkills = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return skills;
    }

    return skills.filter((skill) =>
      [skill.name, skill.description, skill.source, skill.slashCommand].some((value) =>
        value.toLowerCase().includes(normalized),
      ),
    );
  }, [query, skills]);
  const selectedSkill =
    filteredSkills.find((skill) => skill.filePath === selectedSkillPath) ?? filteredSkills[0];

  if (!workspace) {
    return (
      <section className="canvas canvas--empty">
        <div className="empty-panel">
          <div className="session-header__eyebrow">{t("settings.skills.title")}</div>
          <h1>{t("settings.skills.selectWorkspaceTitle")}</h1>
          <p>{t("settings.skills.selectWorkspaceBody")}</p>
        </div>
      </section>
    );
  }

  const createSkill = () =>
    onTrySkill({
      name: "new-skill",
      description: t("settings.skills.newDescription"),
      filePath: "",
      baseDir: workspace.path,
      source: "project",
      enabled: true,
      disableModelInvocation: false,
      slashCommand: "/skill:new-skill",
    });

  const content = (
    <div className={`skills-view ${embedded ? "skills-view--embedded" : "conversation"}`}>
      {!embedded ? (
        <header className="view-header">
          <div>
            <div className="chat-header__eyebrow">{t("settings.skills.title")}</div>
            <h1 className="view-header__title">{t("settings.skills.title")}</h1>
            <p className="view-header__body">{t("settings.skills.body")}</p>
          </div>
        </header>
      ) : null}

      <div className="settings-group settings-catalog">
        <div className="settings-catalog__toolbar">
          <input
            aria-label={t("settings.skills.search")}
            className="settings-search model-manager__filter settings-catalog__search"
            placeholder={t("settings.skills.search")}
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
            <button className="button button--primary" type="button" onClick={createSkill}>
              {t("settings.skills.new")}
            </button>
          </div>
        </div>

        <div className="settings-catalog__body">
          <aside className="settings-catalog__rail" aria-label="Skills">
            <div className="model-manager__rail-head">
              <div>
                <div className="model-manager__section-label">{t("settings.skills.title")}</div>
                <strong>{skills.length}</strong>
              </div>
              {query ? <span className="settings-catalog__result-count">{t("settings.catalog.shown", { count: filteredSkills.length })}</span> : null}
            </div>
            <div className="settings-catalog__list" data-testid="skills-list">
              {filteredSkills.length === 0 ? (
                <SkillsEmptyState title={t("settings.skills.empty")} message={t("settings.skills.emptyBody")} />
              ) : (
                filteredSkills.map((skill) => (
                  <button
                    className={`settings-catalog__item ${selectedSkill?.filePath === skill.filePath ? "settings-catalog__item--active" : ""}`}
                    key={skill.filePath}
                    type="button"
                    onClick={() => {
                      setSelectedSkillPath(skill.filePath);
                    }}
                  >
                    <span className="settings-catalog__item-copy">
                      <span className="settings-catalog__item-title">{titleCase(skill.name)}</span>
                      <span className="settings-catalog__item-description">{skill.description}</span>
                      <span className="settings-catalog__item-meta">
                        <span>{skill.source}</span>
                        <span>{skill.slashCommand}</span>
                        {skill.disableModelInvocation ? <span>{t("settings.skills.slashOnlyBadge")}</span> : null}
                      </span>
                    </span>
                    <span className={`settings-catalog__badge ${skill.enabled ? "settings-catalog__badge--enabled" : ""}`}>
                      {skill.enabled ? t("settings.catalog.enabled") : t("settings.catalog.disabled")}
                    </span>
                  </button>
                ))
              )}
            </div>
          </aside>

          <section className="settings-catalog__detail" aria-label="Skill details">
            {selectedSkill ? (
              <>
                <div className="settings-catalog__detail-head">
                  <div className="settings-catalog__detail-title-block">
                    <div className="model-manager__section-label">{t("settings.skills.selected")}</div>
                    <h2>{titleCase(selectedSkill.name)}</h2>
                    <div className="settings-catalog__mono">{selectedSkill.slashCommand}</div>
                  </div>
                  <span className={`settings-catalog__badge settings-catalog__detail-status ${selectedSkill.enabled ? "settings-catalog__badge--enabled" : ""}`}>
                    {selectedSkill.enabled ? t("settings.catalog.enabled") : t("settings.catalog.disabled")}
                  </span>
                </div>
                <p className="settings-catalog__description">{selectedSkill.description}</p>
                <div className="settings-catalog__meta-grid">
                  <DetailItem label={t("settings.catalog.source")} value={selectedSkill.source} />
                  <DetailItem label={t("settings.skills.invocation")} value={selectedSkill.disableModelInvocation ? t("settings.skills.slashOnly") : t("settings.skills.modelAndSlash")} />
                  <DetailItem label={t("settings.catalog.path")} value={selectedSkill.filePath} mono wide />
                </div>
                <div className="settings-catalog__detail-actions">
                  <button className="button button--secondary model-manager__strong-button" type="button" onClick={() => onOpenSkillFolder(selectedSkill.filePath)}>
                    {t("settings.catalog.openFolder")}
                  </button>
                  <button
                    className="button button--secondary model-manager__strong-button"
                    type="button"
                    onClick={() => onToggleSkill(selectedSkill.filePath, !selectedSkill.enabled)}
                  >
                    {selectedSkill.enabled ? t("settings.catalog.disable") : t("settings.catalog.enable")}
                  </button>
                  <button className="button button--primary" type="button" onClick={() => onTrySkill(selectedSkill)}>
                    {t("settings.skills.try")}
                  </button>
                </div>
              </>
            ) : (
              <SkillsEmptyState title={t("settings.skills.empty")} message={t("settings.skills.emptyRuntime")} />
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

function SkillsEmptyState({ title, message }: { readonly title: string; readonly message: string }) {
  return (
    <div className="settings-catalog__empty">
      <h2>{title}</h2>
      <p>{message}</p>
    </div>
  );
}
