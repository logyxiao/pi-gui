import { useEffect } from "react";
import type { ComposerImageAttachment } from "../desktop-state";
import {
  desktopCommands,
  getDesktopCommandFromShortcut,
  type PiDesktopApi,
  type PiDesktopCommand,
} from "../ipc";

interface ThreadSearchCommands {
  readonly isOpen: boolean;
  readonly open: () => void;
  readonly close: () => void;
}

interface DesktopCommandOptions {
  readonly api: PiDesktopApi | undefined;
  readonly threadSearch: ThreadSearchCommands;
  readonly onOpenSettings: () => void;
  readonly onOpenNewThread: () => void;
  readonly onToggleTerminal: () => void;
  readonly onToggleSidebar: () => boolean;
  readonly onToggleDiffPanel: () => void;
  readonly onWorkspacePicked: (workspaceId: string) => void;
  readonly onClipboardImagePasted: (attachment: ComposerImageAttachment) => void;
}

export function useDesktopCommands({
  api,
  threadSearch,
  onOpenSettings,
  onOpenNewThread,
  onToggleTerminal,
  onToggleSidebar,
  onToggleDiffPanel,
  onWorkspacePicked,
  onClipboardImagePasted,
}: DesktopCommandOptions) {
  useEffect(() => {
    const handleCommand = (command: PiDesktopCommand): boolean => {
      if (command === desktopCommands.openSettings) {
        onOpenSettings();
        return true;
      }
      if (command === desktopCommands.openNewThread) {
        onOpenNewThread();
        return true;
      }
      if (command === desktopCommands.toggleTerminal) {
        onToggleTerminal();
        return true;
      }
      if (command === desktopCommands.toggleSidebar) {
        return onToggleSidebar();
      }
      return false;
    };

    const removeCommandListener = api?.onCommand?.(handleCommand);
    const removeWorkspacePickedListener = api?.onWorkspacePicked?.(onWorkspacePicked);
    const removeClipboardImageListener = api?.onClipboardImagePasted?.(onClipboardImagePasted);

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isEventInsideTerminal(event)) {
        const command = getCommandFromKeyboardEvent(event);
        if (command === desktopCommands.toggleTerminal) {
          event.preventDefault();
          handleCommand(command);
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f" && !event.shiftKey) {
        event.preventDefault();
        if (threadSearch.isOpen) {
          threadSearch.close();
        } else {
          threadSearch.open();
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d" && !event.shiftKey) {
        event.preventDefault();
        onToggleDiffPanel();
        return;
      }

      const command = getCommandFromKeyboardEvent(event);
      if (command && handleCommand(command)) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      removeCommandListener?.();
      removeWorkspacePickedListener?.();
      removeClipboardImageListener?.();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    api,
    onClipboardImagePasted,
    onOpenNewThread,
    onOpenSettings,
    onToggleDiffPanel,
    onToggleSidebar,
    onToggleTerminal,
    onWorkspacePicked,
    threadSearch,
  ]);
}

function getCommandFromKeyboardEvent(event: globalThis.KeyboardEvent): PiDesktopCommand | undefined {
  return getDesktopCommandFromShortcut({
    modifier: event.metaKey || event.ctrlKey,
    shift: event.shiftKey,
    key: event.key,
    code: event.code,
  });
}

function isEventInsideTerminal(event: globalThis.KeyboardEvent): boolean {
  const target = event.target;
  return target instanceof Element && Boolean(target.closest("[data-pi-terminal]"));
}
