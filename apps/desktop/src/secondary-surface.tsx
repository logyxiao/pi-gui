import type { ReactNode } from "react";
import { useI18n } from "./i18n";

export interface SecondarySurfaceNavItem {
  readonly id: string;
  readonly label: string;
}

interface SecondarySurfaceProps {
  readonly title: string;
  readonly onBack: () => void;
  readonly navItems?: readonly SecondarySurfaceNavItem[];
  readonly activeNavId?: string;
  readonly onSelectNav?: (id: string) => void;
  readonly testId?: string;
  readonly children: ReactNode;
}

export function SecondarySurface({
  title,
  onBack,
  navItems = [],
  activeNavId,
  onSelectNav,
  testId,
  children,
}: SecondarySurfaceProps) {
  const { t } = useI18n();

  return (
    <div className="secondary-surface" data-testid={testId} role="dialog" aria-modal="true" aria-label={title}>
      <div className="secondary-surface__backdrop" aria-hidden="true" />
      <div className="secondary-surface__dialog">
        <aside className="secondary-surface__sidebar">
          <button className="secondary-surface__back" type="button" onClick={onBack}>
            <span aria-hidden="true">←</span>
            <span>{t("settings.backToApp")}</span>
          </button>
          <div className="secondary-surface__title">{title}</div>
          {navItems.length > 0 ? (
            <nav className="secondary-surface__nav" aria-label={`${title} sections`}>
              {navItems.map((item) => (
                <button
                  key={item.id}
                  className={`secondary-surface__nav-item ${activeNavId === item.id ? "secondary-surface__nav-item--active" : ""}`}
                  type="button"
                  onClick={() => onSelectNav?.(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          ) : null}
        </aside>
        <main className="secondary-surface__content">
          <button className="secondary-surface__close" type="button" aria-label={t("common.close")} onClick={onBack}>
            ×
          </button>
          {children}
        </main>
      </div>
    </div>
  );
}
