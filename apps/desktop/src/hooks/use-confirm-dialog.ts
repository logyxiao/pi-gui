import { useCallback, useState } from "react";
import type { ConfirmDialogProps } from "../confirm-dialog";

type ConfirmOptions = Partial<Pick<ConfirmDialogProps, "confirmLabel" | "cancelLabel" | "tone">> &
  Pick<ConfirmDialogProps, "title" | "message">;

interface PendingConfirm extends ConfirmOptions {
  readonly resolve: (confirmed: boolean) => void;
}

export interface ConfirmDialogController {
  readonly pending: PendingConfirm | null;
  readonly request: (options: ConfirmOptions) => Promise<boolean>;
  readonly close: (confirmed: boolean) => void;
}

export function useConfirmDialog(): ConfirmDialogController {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const request = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending((current) => {
          current?.resolve(false);
          return { ...options, resolve };
        });
      }),
    [],
  );

  const close = useCallback((confirmed: boolean) => {
    setPending((current) => {
      current?.resolve(confirmed);
      return null;
    });
  }, []);

  return { pending, request, close };
}
