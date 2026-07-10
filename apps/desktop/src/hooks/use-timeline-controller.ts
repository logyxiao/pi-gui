import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AppView, SelectedTranscriptRecord, SessionRecord } from "../desktop-state";
import { VIRTUALIZATION_THRESHOLD } from "../conversation-timeline";

const BOTTOM_ALIGNMENT_EPSILON_PX = 1;

interface TimelineControllerOptions {
  readonly activeTranscript: SelectedTranscriptRecord["transcript"];
  readonly activeView: AppView | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly selectedSessionKey: string;
}

export interface TimelineController {
  readonly timelinePaneRef: React.MutableRefObject<HTMLDivElement | null>;
  readonly disableTimelineVirtualization: boolean;
  readonly showJumpToLatest: boolean;
  readonly finalizeTimelineVirtualizationDisable: () => void;
  readonly handleComposerHeightChange: () => void;
  readonly handleTimelineContentHeightChange: () => void;
  readonly handleTimelineScroll: () => void;
  readonly jumpToLatest: () => void;
  readonly preserveBottomForLayoutChange: (delayFrames?: number) => boolean;
  readonly resetForNonThreadView: () => void;
  readonly setTimelinePaneElement: (node: HTMLDivElement | null) => void;
}

export function useTimelineController({
  activeTranscript,
  activeView,
  selectedSession,
  selectedSessionKey,
}: TimelineControllerOptions): TimelineController {
  const timelinePaneRef = useRef<HTMLDivElement | null>(null);
  const lastTranscriptMarkerRef = useRef("");
  const pinnedToBottomRef = useRef(true);
  const previousTimelinePaneSizeRef = useRef<{ width: number; height: number } | null>(null);
  const lastTimelineScrollTopBySessionRef = useRef(new Map<string, number>());
  const lastTimelinePinnedBySessionRef = useRef(new Map<string, boolean>());
  const preserveBottomOnNextPaneResizeRef = useRef(false);
  const exactBottomRestoreSessionKeyRef = useRef<string | null>(null);
  const deferredPinnedBottomAlignmentRef = useRef(false);
  const pendingPinnedBottomBehaviorRef = useRef<ScrollBehavior>("auto");
  const pendingIncrementalBottomFrameRef = useRef<number | null>(null);
  const lastObservedScrollHeightRef = useRef(0);
  const previousSessionStatusRef = useRef<{
    readonly key: string;
    readonly status: SessionRecord["status"] | undefined;
  }>({ key: "", status: undefined });
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [timelinePaneMountVersion, setTimelinePaneMountVersion] = useState(0);
  const [disableTimelineVirtualization, setDisableTimelineVirtualization] = useState(true);

  const resetExactBottomRestoreState = useCallback((nextSessionKey: string | null = null) => {
    exactBottomRestoreSessionKeyRef.current = nextSessionKey;
    deferredPinnedBottomAlignmentRef.current = false;
    pendingPinnedBottomBehaviorRef.current = "auto";
  }, []);

  const scrollTimelineToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const pane = timelinePaneRef.current;
    if (!pane) {
      return;
    }

    if (pendingIncrementalBottomFrameRef.current != null) {
      window.cancelAnimationFrame(pendingIncrementalBottomFrameRef.current);
      pendingIncrementalBottomFrameRef.current = null;
    }

    const align = (remainingChecks: number) => {
      const targetScrollTop = Math.max(0, pane.scrollHeight - pane.clientHeight);
      if (behavior === "auto") {
        setPaneScrollTop(pane, targetScrollTop);
      } else {
        pane.scrollTo({ top: targetScrollTop, behavior });
      }
      pinnedToBottomRef.current = true;
      lastObservedScrollHeightRef.current = pane.scrollHeight;
      lastTimelineScrollTopBySessionRef.current.set(selectedSessionKey, pane.scrollTop);
      lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, true);
      setShowJumpToLatest(false);

      if (remainingChecks <= 0) {
        return;
      }

      window.requestAnimationFrame(() => {
        const remaining = getBottomRemaining(pane);
        if (remaining > BOTTOM_ALIGNMENT_EPSILON_PX) {
          align(remainingChecks - 1);
        }
      });
    };

    align(behavior === "auto" ? 6 : 0);
  }, [selectedSessionKey]);

  const requestIncrementalBottomAlignment = useCallback(() => {
    if (pendingIncrementalBottomFrameRef.current != null) {
      return;
    }

    pendingIncrementalBottomFrameRef.current = window.requestAnimationFrame(() => {
      pendingIncrementalBottomFrameRef.current = null;
      const pane = timelinePaneRef.current;
      if (!pane || (!pinnedToBottomRef.current && !preserveBottomOnNextPaneResizeRef.current)) {
        return;
      }

      const previousScrollHeight = lastObservedScrollHeightRef.current || pane.scrollHeight;
      const nextScrollHeight = pane.scrollHeight;
      const heightDelta = nextScrollHeight - previousScrollHeight;
      const targetScrollTop = Math.max(0, nextScrollHeight - pane.clientHeight);

      if (heightDelta > 0 && pane.scrollTop < targetScrollTop) {
        setPaneScrollTop(pane, Math.min(targetScrollTop, pane.scrollTop + heightDelta));
      } else {
        setPaneScrollTop(pane, targetScrollTop);
      }

      pinnedToBottomRef.current = true;
      lastObservedScrollHeightRef.current = nextScrollHeight;
      lastTimelineScrollTopBySessionRef.current.set(selectedSessionKey, pane.scrollTop);
      lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, true);
      setShowJumpToLatest(false);
    });
  }, [selectedSessionKey]);

  const requestPinnedBottomAlignment = useCallback((
    behavior: ScrollBehavior = "auto",
    options?: { readonly preferExactRestore?: boolean },
  ) => {
    if (exactBottomRestoreSessionKeyRef.current === selectedSessionKey && selectedSessionKey) {
      pendingPinnedBottomBehaviorRef.current = behavior;
      deferredPinnedBottomAlignmentRef.current = true;
      return;
    }

    if (options?.preferExactRestore && selectedSessionKey && activeTranscript.length > VIRTUALIZATION_THRESHOLD) {
      exactBottomRestoreSessionKeyRef.current = selectedSessionKey;
      pendingPinnedBottomBehaviorRef.current = behavior;
      preserveBottomOnNextPaneResizeRef.current = true;
      setDisableTimelineVirtualization(true);
      return;
    }

    scrollTimelineToBottom(behavior);
  }, [activeTranscript.length, scrollTimelineToBottom, selectedSessionKey]);

  const finalizeTimelineVirtualizationDisable = useCallback(() => {
    const pane = timelinePaneRef.current;
    const restoreSessionKey = exactBottomRestoreSessionKeyRef.current;
    if (!pane || activeView !== "threads") {
      resetExactBottomRestoreState();
      setDisableTimelineVirtualization(false);
      return;
    }

    if (restoreSessionKey !== selectedSessionKey || !restoreSessionKey) {
      setDisableTimelineVirtualization(false);
      return;
    }

    const shouldRestoreBottom =
      pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current || deferredPinnedBottomAlignmentRef.current;
    if (!shouldRestoreBottom) {
      resetExactBottomRestoreState();
      setDisableTimelineVirtualization(false);
      return;
    }

    const finishRestore = (remainingChecks: number, stableChecks: number) => {
      window.requestAnimationFrame(() => {
        if (timelinePaneRef.current !== pane || exactBottomRestoreSessionKeyRef.current !== restoreSessionKey) {
          return;
        }

        if (pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current) {
          scrollTimelineToBottom();
        }

        const remaining = pane.scrollHeight - pane.scrollTop - pane.clientHeight;
        const nextStableChecks = remaining <= 16 ? stableChecks + 1 : 0;
        if (remainingChecks <= 1 || nextStableChecks >= 2) {
          const shouldApplyDeferredAlignment = deferredPinnedBottomAlignmentRef.current;
          resetExactBottomRestoreState();
          if (shouldApplyDeferredAlignment) {
            scrollTimelineToBottom();
          }
          preserveBottomOnNextPaneResizeRef.current = false;
          return;
        }

        finishRestore(remainingChecks - 1, nextStableChecks);
      });
    };

    if (pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current) {
      scrollTimelineToBottom();
    }

    window.requestAnimationFrame(() => {
      if (timelinePaneRef.current !== pane || exactBottomRestoreSessionKeyRef.current !== restoreSessionKey) {
        return;
      }
      setDisableTimelineVirtualization(false);
      scrollTimelineToBottom(pendingPinnedBottomBehaviorRef.current);
      pendingPinnedBottomBehaviorRef.current = "auto";
      finishRestore(6, 0);
    });
  }, [activeView, resetExactBottomRestoreState, scrollTimelineToBottom, selectedSessionKey]);

  const setTimelinePaneElement = useCallback((node: HTMLDivElement | null) => {
    timelinePaneRef.current = node;
    if (!node) {
      return;
    }

    setTimelinePaneMountVersion((current) => current + 1);
    lastObservedScrollHeightRef.current = node.scrollHeight;

    const savedPinned = lastTimelinePinnedBySessionRef.current.get(selectedSessionKey);
    const savedScrollTop = lastTimelineScrollTopBySessionRef.current.get(selectedSessionKey);

    if (!selectedSessionKey || activeView !== "threads") {
      setDisableTimelineVirtualization(false);
      return;
    }

    const shouldRestoreBottom = (savedPinned ?? pinnedToBottomRef.current) || preserveBottomOnNextPaneResizeRef.current;
    if (shouldRestoreBottom) {
      preserveBottomOnNextPaneResizeRef.current = true;
      node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
      lastObservedScrollHeightRef.current = node.scrollHeight;
      window.requestAnimationFrame(() => {
        if (timelinePaneRef.current !== node) {
          return;
        }
        if (pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current) {
          requestPinnedBottomAlignment("auto", { preferExactRestore: true });
        }
      });
      return;
    }

    if (savedScrollTop == null) {
      setDisableTimelineVirtualization(false);
      return;
    }

    node.scrollTop = savedScrollTop;
    pinnedToBottomRef.current = false;
    lastObservedScrollHeightRef.current = node.scrollHeight;
    resetExactBottomRestoreState();
    lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, false);
    window.requestAnimationFrame(() => {
      if (timelinePaneRef.current !== node) {
        return;
      }
      setDisableTimelineVirtualization(false);
    });
  }, [activeView, requestPinnedBottomAlignment, resetExactBottomRestoreState, selectedSessionKey]);

  const schedulePinnedBottomRealignment = useCallback((delayFrames = 0) => {
    const waitForFrames = (remainingFrames: number) => {
      window.requestAnimationFrame(() => {
        if (remainingFrames > 0) {
          waitForFrames(remainingFrames - 1);
          return;
        }
        requestPinnedBottomAlignment("auto", { preferExactRestore: true });
        window.requestAnimationFrame(() => {
          preserveBottomOnNextPaneResizeRef.current = false;
          if (pinnedToBottomRef.current) {
            requestPinnedBottomAlignment("auto", { preferExactRestore: true });
          }
        });
      });
    };

    waitForFrames(delayFrames);
  }, [requestPinnedBottomAlignment]);

  const preserveBottomForLayoutChange = useCallback((delayFrames = 3) => {
    const pane = timelinePaneRef.current;
    const shouldPreserveBottom = pane ? isNearBottom(pane) || pinnedToBottomRef.current : pinnedToBottomRef.current;
    if (shouldPreserveBottom) {
      preserveBottomOnNextPaneResizeRef.current = true;
      schedulePinnedBottomRealignment(delayFrames);
    }
    return shouldPreserveBottom;
  }, [schedulePinnedBottomRealignment]);

  const resetForNonThreadView = useCallback(() => {
    previousTimelinePaneSizeRef.current = null;
    resetExactBottomRestoreState();
  }, [resetExactBottomRestoreState]);

  useLayoutEffect(() => {
    setShowJumpToLatest(false);
    lastTranscriptMarkerRef.current = "";
    pinnedToBottomRef.current = true;
    previousTimelinePaneSizeRef.current = null;
    preserveBottomOnNextPaneResizeRef.current = false;
    lastObservedScrollHeightRef.current = timelinePaneRef.current?.scrollHeight ?? 0;
    if (pendingIncrementalBottomFrameRef.current != null) {
      window.cancelAnimationFrame(pendingIncrementalBottomFrameRef.current);
      pendingIncrementalBottomFrameRef.current = null;
    }
    resetExactBottomRestoreState(selectedSessionKey || null);
    setDisableTimelineVirtualization(Boolean(selectedSessionKey));
  }, [resetExactBottomRestoreState, selectedSessionKey]);

  useLayoutEffect(() => {
    if (activeView !== "threads" || !selectedSession || activeTranscript.length === 0) {
      return;
    }
    if (exactBottomRestoreSessionKeyRef.current !== selectedSessionKey) {
      return;
    }
    if (!pinnedToBottomRef.current && !preserveBottomOnNextPaneResizeRef.current) {
      return;
    }

    scrollTimelineToBottom();
  }, [
    activeTranscript,
    activeView,
    disableTimelineVirtualization,
    scrollTimelineToBottom,
    selectedSession,
    selectedSessionKey,
  ]);

  useLayoutEffect(() => {
    if (activeView !== "threads" || !selectedSession) {
      return undefined;
    }

    return () => {
      const pane = timelinePaneRef.current;
      if (!pane) {
        return;
      }
      lastTimelineScrollTopBySessionRef.current.set(selectedSessionKey, pane.scrollTop);
      lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, isNearBottom(pane));
    };
  }, [activeView, selectedSession, selectedSessionKey]);

  useLayoutEffect(() => {
    const previous = previousSessionStatusRef.current;
    const nextStatus = selectedSession?.status;
    previousSessionStatusRef.current = { key: selectedSessionKey, status: nextStatus };

    if (previous.key !== selectedSessionKey || previous.status !== "running" || nextStatus === "running") {
      return;
    }

    if (pendingIncrementalBottomFrameRef.current != null) {
      window.cancelAnimationFrame(pendingIncrementalBottomFrameRef.current);
      pendingIncrementalBottomFrameRef.current = null;
    }

    if (!pinnedToBottomRef.current && !preserveBottomOnNextPaneResizeRef.current) {
      preserveBottomOnNextPaneResizeRef.current = false;
      return;
    }

    requestIncrementalBottomAlignment();
    window.requestAnimationFrame(() => {
      preserveBottomOnNextPaneResizeRef.current = false;
      const pane = timelinePaneRef.current;
      if (!pane) {
        return;
      }
      lastObservedScrollHeightRef.current = pane.scrollHeight;
      lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, isNearBottom(pane));
      lastTimelineScrollTopBySessionRef.current.set(selectedSessionKey, pane.scrollTop);
    });
  }, [requestIncrementalBottomAlignment, selectedSession?.status, selectedSessionKey]);

  useLayoutEffect(() => {
    const pane = timelinePaneRef.current;
    if (!pane || !selectedSession || activeView !== "threads") {
      previousTimelinePaneSizeRef.current = null;
      return undefined;
    }

    const stickToBottomAfterLayoutChange = () => {
      preserveBottomOnNextPaneResizeRef.current = false;
      pinnedToBottomRef.current = true;
      window.requestAnimationFrame(() => {
        requestPinnedBottomAlignment("auto", { preferExactRestore: true });
        window.requestAnimationFrame(() => {
          if (pinnedToBottomRef.current) {
            requestPinnedBottomAlignment("auto", { preferExactRestore: true });
          }
        });
      });
    };

    const updateMeasuredSize = (nextSize: { width: number; height: number }) => {
      const previousSize = previousTimelinePaneSizeRef.current;
      previousTimelinePaneSizeRef.current = nextSize;
      const shouldStickToBottom = preserveBottomOnNextPaneResizeRef.current || pinnedToBottomRef.current;
      const widthChanged = previousSize ? Math.abs(nextSize.width - previousSize.width) >= 1 : false;
      const heightChanged = previousSize ? Math.abs(nextSize.height - previousSize.height) >= 1 : false;
      if (!previousSize) {
        return;
      }
      if (!widthChanged && !heightChanged) {
        return;
      }

      if (shouldStickToBottom) {
        stickToBottomAfterLayoutChange();
      }
    };

    const paneRect = pane.getBoundingClientRect();
    updateMeasuredSize({ width: paneRect.width, height: paneRect.height });

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      updateMeasuredSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });

    resizeObserver.observe(pane);
    return () => {
      resizeObserver.disconnect();
      previousTimelinePaneSizeRef.current = null;
    };
  }, [activeView, requestPinnedBottomAlignment, selectedSession, selectedSessionKey, timelinePaneMountVersion]);

  useEffect(() => {
    const pane = timelinePaneRef.current;
    if (!pane || !selectedSession) {
      return;
    }

    const marker = buildTranscriptChangeMarker(selectedSessionKey, activeTranscript);
    if (marker === lastTranscriptMarkerRef.current) {
      return;
    }
    lastTranscriptMarkerRef.current = marker;

    if (pinnedToBottomRef.current) {
      requestIncrementalBottomAlignment();
      return;
    }

    setShowJumpToLatest(true);
  }, [activeTranscript, requestIncrementalBottomAlignment, selectedSession, selectedSessionKey]);

  const handleComposerHeightChange = useCallback(() => {
    const pane = timelinePaneRef.current;
    const shouldPreserveBottom = pane
      ? isNearBottom(pane) || pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current
      : pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current;

    if (!shouldPreserveBottom) {
      return;
    }

    preserveBottomOnNextPaneResizeRef.current = true;
    requestPinnedBottomAlignment("auto", { preferExactRestore: true });
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        preserveBottomOnNextPaneResizeRef.current = false;
        if (pinnedToBottomRef.current) {
          requestPinnedBottomAlignment("auto", { preferExactRestore: true });
        }
      });
    });
  }, [requestPinnedBottomAlignment]);

  const handleTimelineContentHeightChange = useCallback(() => {
    if (!pinnedToBottomRef.current && !preserveBottomOnNextPaneResizeRef.current) {
      return;
    }

    window.requestAnimationFrame(() => {
      if (!pinnedToBottomRef.current && !preserveBottomOnNextPaneResizeRef.current) {
        return;
      }
      requestIncrementalBottomAlignment();
    });
  }, [requestIncrementalBottomAlignment]);

  const handleTimelineScroll = useCallback(() => {
    const pane = timelinePaneRef.current;
    if (!pane) {
      return;
    }

    const pinned = isNearBottom(pane);
    if (preserveBottomOnNextPaneResizeRef.current && !pinned) {
      return;
    }

    pinnedToBottomRef.current = pinned;
    lastObservedScrollHeightRef.current = pane.scrollHeight;
    lastTimelineScrollTopBySessionRef.current.set(selectedSessionKey, pane.scrollTop);
    lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, pinned);
    if (pinned) {
      setShowJumpToLatest(false);
    }
  }, [selectedSessionKey]);

  const jumpToLatest = useCallback(() => {
    requestPinnedBottomAlignment("smooth", { preferExactRestore: true });
  }, [requestPinnedBottomAlignment]);

  return useMemo(
    () => ({
      timelinePaneRef,
      disableTimelineVirtualization,
      showJumpToLatest,
      finalizeTimelineVirtualizationDisable,
      handleComposerHeightChange,
      handleTimelineContentHeightChange,
      handleTimelineScroll,
      jumpToLatest,
      preserveBottomForLayoutChange,
      resetForNonThreadView,
      setTimelinePaneElement,
    }),
    [
      disableTimelineVirtualization,
      finalizeTimelineVirtualizationDisable,
      handleComposerHeightChange,
      handleTimelineContentHeightChange,
      handleTimelineScroll,
      jumpToLatest,
      preserveBottomForLayoutChange,
      resetForNonThreadView,
      setTimelinePaneElement,
      showJumpToLatest,
    ],
  );
}

function buildTranscriptChangeMarker(sessionKey: string, transcript: SelectedTranscriptRecord["transcript"]): string {
  const lastItem = transcript.at(-1);
  if (!lastItem) return `${sessionKey}:0`;
  const changingContent = lastItem.kind === "message"
    ? lastItem.text.length
    : lastItem.kind === "tool"
      ? `${lastItem.status}:${typeof lastItem.output === "string" ? lastItem.output.length : lastItem.output ? 1 : 0}`
      : lastItem.kind === "activity"
        ? `${lastItem.label.length}:${lastItem.detail?.length ?? 0}`
        : lastItem.label.length;
  return `${sessionKey}:${transcript.length}:${lastItem.id}:${changingContent}`;
}

function isNearBottom(element: HTMLDivElement): boolean {
  return getBottomRemaining(element) < 32;
}

function getBottomRemaining(element: HTMLDivElement): number {
  return Math.max(0, element.scrollHeight - element.scrollTop - element.clientHeight);
}

function setPaneScrollTop(element: HTMLDivElement, scrollTop: number): void {
  if (Math.abs(element.scrollTop - scrollTop) <= BOTTOM_ALIGNMENT_EPSILON_PX) {
    return;
  }
  element.scrollTop = scrollTop;
}
