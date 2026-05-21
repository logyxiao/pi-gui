import { useEffect, useState } from "react";
import { useI18n } from "../i18n";

export function useRunningLabel(startedAt: string | undefined) {
  const { t } = useI18n();
  const [label, setLabel] = useState(() => formatRunningLabel(startedAt, t));

  useEffect(() => {
    setLabel(formatRunningLabel(startedAt, t));
    if (!startedAt) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setLabel(formatRunningLabel(startedAt, t));
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [startedAt, t]);

  return label;
}

function formatRunningLabel(startedAt: string | undefined, t: ReturnType<typeof useI18n>["t"]): string {
  if (!startedAt) {
    return t("timeline.working");
  }

  const diffMs = Math.max(0, Date.now() - Date.parse(startedAt));
  const seconds = Math.max(1, Math.floor(diffMs / 1000));
  if (seconds < 60) {
    return t("timeline.workingFor", { duration: t("timeline.durationSeconds", { seconds }) });
  }

  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  const duration = remaining === 0
    ? t("timeline.durationMinutes", { minutes })
    : t("timeline.durationMinutesSeconds", { minutes, seconds: remaining });
  return t("timeline.workingFor", { duration });
}
