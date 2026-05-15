import { useEffect, useRef } from "react";
import { useI18n } from "./i18n";

export interface ConfirmDialogProps {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly tone?: "default" | "danger";
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone = "default",
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div className="confirm-dialog-backdrop" role="presentation" onClick={onCancel}>
      <section
        aria-labelledby="confirm-dialog-title"
        aria-modal="true"
        className="confirm-dialog"
        data-testid="confirm-dialog"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={`confirm-dialog__mark confirm-dialog__mark--${tone}`} aria-hidden="true">
          !
        </div>
        <div className="confirm-dialog__content">
          <h2 className="confirm-dialog__title" id="confirm-dialog-title">
            {title}
          </h2>
          <p className="confirm-dialog__body">{message}</p>
        </div>
        <div className="confirm-dialog__actions">
          <button
            className="button button--secondary"
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
          >
            {cancelLabel ?? t("common.cancel")}
          </button>
          <button
            className={`button ${tone === "danger" ? "button--danger" : "button--primary"}`}
            type="button"
            onClick={onConfirm}
          >
            {confirmLabel ?? t("common.confirm")}
          </button>
        </div>
      </section>
    </div>
  );
}
