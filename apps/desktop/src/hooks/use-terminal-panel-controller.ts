import { useCallback, useEffect, useState } from "react";

interface UseTerminalPanelControllerInput {
  readonly focusComposer: () => void;
  readonly selectedSessionKey: string;
  readonly workspaceCount: number;
}

export function useTerminalPanelController({
  focusComposer,
  selectedSessionKey,
  workspaceCount,
}: UseTerminalPanelControllerInput) {
  const [openTerminalSessionKeys, setOpenTerminalSessionKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [takeoverTerminalSessionKeys, setTakeoverTerminalSessionKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [terminalHeight, setTerminalHeight] = useState(340);

  useEffect(() => {
    if (workspaceCount === 0) {
      setOpenTerminalSessionKeys(new Set());
      setTakeoverTerminalSessionKeys(new Set());
    }
  }, [workspaceCount]);

  const isTerminalVisibleForSelectedThread =
    Boolean(selectedSessionKey) && openTerminalSessionKeys.has(selectedSessionKey);
  const isTerminalTakeoverForSelectedThread =
    Boolean(selectedSessionKey) && takeoverTerminalSessionKeys.has(selectedSessionKey);

  const toggleTerminal = useCallback(() => {
    if (!selectedSessionKey) {
      return;
    }
    if (openTerminalSessionKeys.has(selectedSessionKey)) {
      setOpenTerminalSessionKeys((current) => {
        const next = new Set(current);
        next.delete(selectedSessionKey);
        return next;
      });
      setTakeoverTerminalSessionKeys((current) => {
        const next = new Set(current);
        next.delete(selectedSessionKey);
        return next;
      });
      return;
    }
    setOpenTerminalSessionKeys((current) => new Set(current).add(selectedSessionKey));
  }, [openTerminalSessionKeys, selectedSessionKey]);

  const showTerminal = useCallback(() => {
    if (!selectedSessionKey) {
      return;
    }
    setOpenTerminalSessionKeys((current) => new Set(current).add(selectedSessionKey));
  }, [selectedSessionKey]);

  const handleTerminalHeightChange = useCallback((nextHeight: number) => {
    setTerminalHeight(nextHeight);
    setTakeoverTerminalSessionKeys((current) => {
      const next = new Set(current);
      next.delete(selectedSessionKey);
      return next;
    });
  }, [selectedSessionKey]);

  const toggleTerminalTakeover = useCallback(() => {
    setTakeoverTerminalSessionKeys((current) => {
      const next = new Set(current);
      if (next.has(selectedSessionKey)) {
        next.delete(selectedSessionKey);
      } else {
        next.add(selectedSessionKey);
      }
      return next;
    });
  }, [selectedSessionKey]);

  const hideTerminal = useCallback(() => {
    setOpenTerminalSessionKeys((current) => {
      const next = new Set(current);
      next.delete(selectedSessionKey);
      return next;
    });
    setTakeoverTerminalSessionKeys((current) => {
      const next = new Set(current);
      next.delete(selectedSessionKey);
      return next;
    });
    focusComposer();
  }, [focusComposer, selectedSessionKey]);

  return {
    handleTerminalHeightChange,
    hideTerminal,
    isTerminalTakeoverForSelectedThread,
    isTerminalVisibleForSelectedThread,
    terminalHeight,
    showTerminal,
    toggleTerminal,
    toggleTerminalTakeover,
  };
}
