import { memo } from "react";
import type { RuntimeSnapshot, RuntimeSettingsSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { RuntimeSkillRecord } from "@pi-gui/session-driver/runtime-types";
import type {
  ExtensionCommandCompatibilityRecord,
  ModelSettingsScopeMode,
  NotificationPreferences,
  WorkspaceRecord,
} from "./desktop-state";
import type { DesktopNotificationPermissionStatus } from "./ipc";
import { SettingsView, type SettingsSection } from "./settings-view";
import { SecondarySurface } from "./secondary-surface";
import { SearchableSelect } from "./searchable-select";
import { useI18n, type LanguageCode } from "./i18n";

interface NavItem {
  readonly id: string;
  readonly label: string;
}

export interface SettingsSurfaceProps {
  readonly section: SettingsSection;
  readonly settingsWorkspace?: WorkspaceRecord;
  readonly settingsRuntime?: RuntimeSnapshot;
  readonly settingsModelRuntime?: RuntimeSnapshot;
  readonly rootWorkspaceOptions: readonly WorkspaceRecord[];
  readonly settingsWorkspaceId: string;
  readonly notificationPreferences: NotificationPreferences;
  readonly notificationPermissionStatus: DesktopNotificationPermissionStatus;
  readonly notificationPermissionPending: boolean;
  readonly modelSettingsScopeMode: ModelSettingsScopeMode;
  readonly integratedTerminalShell: string;
  readonly themeMode: "system" | "light" | "dark";
  readonly language: LanguageCode;
  readonly commandCompatibility: readonly ExtensionCommandCompatibilityRecord[];
  readonly navItems: readonly NavItem[];
  readonly onBack: () => void;
  readonly onSelectSection: (section: SettingsSection) => void;
  readonly onSelectWorkspaceId: (workspaceId: string) => void;
  readonly onLoginProvider: (providerId: string) => void;
  readonly onLogoutProvider: (providerId: string) => void;
  readonly onSetProviderApiKey: (providerId: string, apiKey: string) => Promise<string | undefined>;
  readonly onRemoveProviderApiKey: (providerId: string) => Promise<string | undefined>;
  readonly onSetModelSettingsScopeMode: (mode: ModelSettingsScopeMode) => void;
  readonly onSetDefaultModel: (provider: string, modelId: string) => void;
  readonly onSetThinkingLevel: (level: RuntimeSettingsSnapshot["defaultThinkingLevel"]) => void;
  readonly onSetNotificationPreferences: (preferences: Partial<NotificationPreferences>) => void;
  readonly onSetIntegratedTerminalShell: (shellPath: string) => void;
  readonly onRequestNotificationPermission: () => void;
  readonly onOpenSystemNotificationSettings: () => void;
  readonly onSetThemeMode: (mode: "system" | "light" | "dark") => void;
  readonly onSetLanguage: (language: LanguageCode) => void;
  readonly onToggleSkillCommands: (enabled: boolean) => void;
  readonly onRefreshRuntime: () => void;
  readonly onOpenSkillFolder: (filePath: string) => void;
  readonly onToggleSkill: (filePath: string, enabled: boolean) => void;
  readonly onTrySkill: (skill: RuntimeSkillRecord) => void;
  readonly onOpenExtensionFolder: (filePath: string) => void;
  readonly onToggleExtension: (filePath: string, enabled: boolean) => void;
}

function SettingsSurfaceImpl(props: SettingsSurfaceProps) {
  const { t } = useI18n();
  const {
    section,
    settingsWorkspace,
    settingsRuntime,
    settingsModelRuntime,
    rootWorkspaceOptions,
    settingsWorkspaceId,
    modelSettingsScopeMode,
    navItems,
    onBack,
    onSelectSection,
    onSelectWorkspaceId,
  } = props;

  const showWorkspacePicker =
    section === "providers"
    || section === "skills"
    || section === "extensions"
    || (section === "models" && modelSettingsScopeMode === "per-repo");

  return (
    <SecondarySurface
      activeNavId={section}
      navItems={navItems}
      onBack={onBack}
      onSelectNav={(next) => onSelectSection(next as SettingsSection)}
      testId="settings-surface"
      title={t("settings.title")}
    >
      {showWorkspacePicker ? (
        <div className="surface-toolbar">
          <label className="surface-toolbar__field">
            <span>{t("common.workspace")}</span>
            <SearchableSelect
              value={settingsWorkspace?.id ?? settingsWorkspaceId}
              placeholder={t("common.workspace")}
              searchPlaceholder={t("common.workspace")}
              options={rootWorkspaceOptions.map((workspace) => ({ value: workspace.id, label: workspace.name }))}
              onChange={onSelectWorkspaceId}
            />
          </label>
        </div>
      ) : null}
      <SettingsView
        workspace={settingsWorkspace}
        runtime={section === "models" ? settingsModelRuntime : settingsRuntime}
        section={section}
        notificationPreferences={props.notificationPreferences}
        notificationPermissionStatus={props.notificationPermissionStatus}
        notificationPermissionPending={props.notificationPermissionPending}
        modelSettingsScopeMode={modelSettingsScopeMode}
        integratedTerminalShell={props.integratedTerminalShell}
        themeMode={props.themeMode}
        language={props.language}
        onLoginProvider={props.onLoginProvider}
        onLogoutProvider={props.onLogoutProvider}
        onSetProviderApiKey={props.onSetProviderApiKey}
        onRemoveProviderApiKey={props.onRemoveProviderApiKey}
        onSetModelSettingsScopeMode={props.onSetModelSettingsScopeMode}
        onSetDefaultModel={props.onSetDefaultModel}
        onSetNotificationPreferences={props.onSetNotificationPreferences}
        onSetIntegratedTerminalShell={props.onSetIntegratedTerminalShell}
        onRequestNotificationPermission={props.onRequestNotificationPermission}
        onOpenSystemNotificationSettings={props.onOpenSystemNotificationSettings}
        onSetThemeMode={props.onSetThemeMode}
        onSetLanguage={props.onSetLanguage}
        onSetThinkingLevel={props.onSetThinkingLevel}
        onToggleSkillCommands={props.onToggleSkillCommands}
        commandCompatibility={props.commandCompatibility}
        onRefreshRuntime={props.onRefreshRuntime}
        onOpenSkillFolder={props.onOpenSkillFolder}
        onToggleSkill={props.onToggleSkill}
        onTrySkill={props.onTrySkill}
        onOpenExtensionFolder={props.onOpenExtensionFolder}
        onToggleExtension={props.onToggleExtension}
      />
    </SecondarySurface>
  );
}

export const SettingsSurface = memo(SettingsSurfaceImpl);
