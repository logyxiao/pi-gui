import { useCallback, useEffect, useState } from "react";
import type { DesktopNotificationPermissionStatus } from "../ipc";

export interface NotificationPermissionController {
  readonly status: DesktopNotificationPermissionStatus;
  readonly pending: boolean;
  readonly setPending: (pending: boolean) => void;
  readonly refresh: () => Promise<DesktopNotificationPermissionStatus>;
}

export function useNotificationPermission(active: boolean): NotificationPermissionController {
  const [status, setStatus] = useState<DesktopNotificationPermissionStatus>("unknown");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const piApi = window.piApp;
    if (!piApi?.onNotificationPermissionStatusChanged) return;
    return piApi.onNotificationPermissionStatusChanged((next) => setStatus(next));
  }, []);

  const refresh = useCallback(async () => {
    const piApi = window.piApp;
    if (!piApi?.getNotificationPermissionStatus) {
      return "unknown" as DesktopNotificationPermissionStatus;
    }
    const next = await piApi.getNotificationPermissionStatus();
    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    if (!active) return;
    void refresh();
  }, [active, refresh]);

  return { status, pending, setPending, refresh };
}
