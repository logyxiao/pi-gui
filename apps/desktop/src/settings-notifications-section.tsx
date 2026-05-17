import type { DesktopNotificationPermissionStatus } from "./ipc";
import type { NotificationPreferences } from "./desktop-state";
import { SettingsGroup, SettingsRow } from "./settings-utils";
import { useI18n, type I18nContextValue } from "./i18n";

interface SettingsNotificationsSectionProps {
  readonly notificationPreferences: NotificationPreferences;
  readonly notificationPermissionStatus: DesktopNotificationPermissionStatus;
  readonly notificationPermissionPending: boolean;
  readonly onSetNotificationPreferences: (preferences: Partial<NotificationPreferences>) => void;
  readonly onRequestNotificationPermission: () => void;
  readonly onOpenSystemNotificationSettings: () => void;
}

export function SettingsNotificationsSection({
  notificationPreferences,
  notificationPermissionStatus,
  notificationPermissionPending,
  onSetNotificationPreferences,
  onRequestNotificationPermission,
  onOpenSystemNotificationSettings,
}: SettingsNotificationsSectionProps) {
  const { t } = useI18n();
  const statusLabel = labelForPermissionStatus(notificationPermissionStatus, t);
  const statusDescription = descriptionForPermissionStatus(notificationPermissionStatus, t);
  const showAskMacOs = notificationPermissionStatus === "default";
  const showOpenSystemSettings = notificationPermissionStatus === "denied";
  const showRecoveryActions = showAskMacOs || showOpenSystemSettings;

  return (
    <>
      <SettingsGroup
        title={t("settings.notifications.systemTitle")}
        description={t("settings.notifications.systemDescription")}
      >
        <SettingsRow title={t("settings.notifications.macAccess")} description={statusDescription}>
          <span className="settings-row__value">{statusLabel}</span>
        </SettingsRow>
        {showRecoveryActions ? (
          <SettingsRow
            title={t("settings.notifications.turnOnTitle")}
            description={
              showAskMacOs
                ? t("settings.notifications.turnOnDefaultDesc")
                : t("settings.notifications.turnOnDeniedDesc")
            }
          >
            <div className="settings-row__actions">
              {showAskMacOs ? (
                <button
                  className="button button--secondary"
                  disabled={notificationPermissionPending}
                  type="button"
                  onClick={onRequestNotificationPermission}
                >
                  {t("settings.notifications.askMac")}
                </button>
              ) : null}
              {showOpenSystemSettings ? (
                <button
                  className="button button--secondary"
                  disabled={notificationPermissionPending}
                  type="button"
                  onClick={onOpenSystemNotificationSettings}
                >
                  {t("settings.notifications.openSystemSettings")}
                </button>
              ) : null}
            </div>
          </SettingsRow>
        ) : null}
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.notifications.alertsTitle")}
        description={t("settings.notifications.alertsDescription")}
      >
        <SettingsRow
          title={t("settings.notifications.backgroundCompletion")}
          description={t("settings.notifications.backgroundCompletionDesc")}
        >
          <input
            aria-label={t("settings.notifications.backgroundCompletion")}
            checked={notificationPreferences.backgroundCompletion}
            type="checkbox"
            onChange={(event) => onSetNotificationPreferences({ backgroundCompletion: event.target.checked })}
          />
        </SettingsRow>
        <SettingsRow
          title={t("settings.notifications.backgroundFailures")}
          description={t("settings.notifications.backgroundFailuresDesc")}
        >
          <input
            aria-label={t("settings.notifications.backgroundFailures")}
            checked={notificationPreferences.backgroundFailure}
            type="checkbox"
            onChange={(event) => onSetNotificationPreferences({ backgroundFailure: event.target.checked })}
          />
        </SettingsRow>
        <SettingsRow
          title={t("settings.notifications.attentionNeeded")}
          description={t("settings.notifications.attentionNeededDesc")}
        >
          <input
            aria-label={t("settings.notifications.attentionNeeded")}
            checked={notificationPreferences.attentionNeeded}
            type="checkbox"
            onChange={(event) => onSetNotificationPreferences({ attentionNeeded: event.target.checked })}
          />
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

function labelForPermissionStatus(
  status: DesktopNotificationPermissionStatus,
  t: I18nContextValue["t"],
): string {
  switch (status) {
    case "granted":
      return t("settings.notifications.status.granted");
    case "denied":
      return t("settings.notifications.status.denied");
    case "default":
      return t("settings.notifications.status.default");
    case "unsupported":
      return t("settings.notifications.status.unsupported");
    default:
      return t("settings.notifications.status.checking");
  }
}

function descriptionForPermissionStatus(
  status: DesktopNotificationPermissionStatus,
  t: I18nContextValue["t"],
): string {
  switch (status) {
    case "granted":
      return t("settings.notifications.statusDesc.granted");
    case "denied":
      return t("settings.notifications.statusDesc.denied");
    case "default":
      return t("settings.notifications.statusDesc.default");
    case "unsupported":
      return t("settings.notifications.statusDesc.unsupported");
    default:
      return t("settings.notifications.statusDesc.checking");
  }
}
