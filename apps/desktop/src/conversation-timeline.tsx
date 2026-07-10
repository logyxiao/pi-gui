import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type RefCallback, type RefObject } from "react";
import type { TranscriptMessage } from "./desktop-state";
import { ThreadSearchBar } from "./thread-search";
import { TimelineItem } from "./timeline-item";

const OVERSCAN_PX = 720;
const ROW_GAP_PX = 14;
export const VIRTUALIZATION_THRESHOLD = 80;

export interface ThreadSearchModel {
  readonly isOpen: boolean;
  readonly query: string;
  readonly matchCount: number;
  readonly activeIndex: number;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly search: (query: string) => void;
  readonly goToMatch: (direction: 1 | -1) => void;
  readonly close: () => void;
}

export interface ConversationTimelineNavItem {
  readonly id: string;
  readonly itemId: string;
  readonly index: number;
  readonly kind: "user";
  readonly label: string;
  readonly detail?: string;
  readonly ordinal: number;
}

export interface ConversationTimelineProps {
  readonly transcript: readonly TranscriptMessage[];
  readonly isTranscriptLoading: boolean;
  readonly timelinePaneRef: MutableRefObject<HTMLDivElement | null>;
  readonly timelinePaneElementRef?: RefCallback<HTMLDivElement>;
  readonly disableVirtualization?: boolean;
  readonly onDisableVirtualizationReady?: () => void;
  readonly onTimelineScroll: () => void;
  readonly threadSearch: ThreadSearchModel;
  readonly showJumpToLatest: boolean;
  readonly onJumpToLatest: () => void;
  readonly onContentHeightChange: () => void;
  readonly onViewFileInDiff?: (path: string) => void;
}

function ConversationTimelineComponent({
  transcript,
  isTranscriptLoading,
  timelinePaneRef,
  timelinePaneElementRef,
  disableVirtualization = false,
  onDisableVirtualizationReady,
  onTimelineScroll,
  threadSearch,
  showJumpToLatest,
  onJumpToLatest,
  onContentHeightChange,
  onViewFileInDiff,
}: ConversationTimelineProps) {
  // Attachment-heavy rows routinely blow past the estimator, so keep those
  // transcripts on the exact DOM path instead of restoring to a fake bottom.
  const hasUnreliableVirtualizedHeights = transcript.some(
    (item) => item.kind === "message" && Boolean(item.attachments?.length),
  );
  const shouldVirtualize =
    !threadSearch.isOpen &&
    transcript.length > VIRTUALIZATION_THRESHOLD &&
    !disableVirtualization &&
    !hasUnreliableVirtualizedHeights;
  const [expandedToolCallIds, setExpandedToolCallIds] = useState<Set<string>>(() => new Set());
  const measuredHeightsRef = useRef(new Map<string, number>());
  const rowOffsetsRef = useRef<readonly number[]>([]);
  const rowHeightsRef = useRef<readonly number[]>([]);
  const activeNavFrameRef = useRef<number | null>(null);
  const pendingScrollTargetRef = useRef<{ readonly itemId: string; readonly index: number } | null>(null);
  const [measurementVersion, setMeasurementVersion] = useState(0);
  const [activeNavItemId, setActiveNavItemId] = useState<string | null>(null);
  const timelineNavItems = useMemo(() => buildConversationTimelineNavItems(transcript), [transcript]);

  useLayoutEffect(() => {
    const availableToolCallIds = new Set(
      transcript.filter((item): item is Extract<TranscriptMessage, { kind: "tool" }> => item.kind === "tool").map((item) => item.callId),
    );
    setExpandedToolCallIds((current) => {
      if (current.size === 0) {
        return current;
      }
      let changed = false;
      const next = new Set<string>();
      for (const callId of current) {
        if (!availableToolCallIds.has(callId)) {
          changed = true;
          continue;
        }
        next.add(callId);
      }
      return changed ? next : current;
    });
  }, [transcript]);

  useLayoutEffect(() => {
    const knownIds = new Set(transcript.map((item) => item.id));
    let removedAny = false;
    for (const id of measuredHeightsRef.current.keys()) {
      if (knownIds.has(id)) {
        continue;
      }
      measuredHeightsRef.current.delete(id);
      removedAny = true;
    }
    if (removedAny) {
      setMeasurementVersion((current) => current + 1);
    }
  }, [transcript]);

  useLayoutEffect(() => {
    if (!disableVirtualization || isTranscriptLoading || transcript.length === 0) {
      return;
    }
    const allRowsMeasured = transcript.every((item) => measuredHeightsRef.current.has(item.id));
    if (!allRowsMeasured) {
      return;
    }
    onDisableVirtualizationReady?.();
  }, [disableVirtualization, isTranscriptLoading, measurementVersion, onDisableVirtualizationReady, transcript]);

  const toggleToolCall = useCallback((callId: string) => {
    setExpandedToolCallIds((current) => {
      const next = new Set(current);
      if (next.has(callId)) {
        next.delete(callId);
      } else {
        next.add(callId);
      }
      return next;
    });
  }, []);

  const updateMeasuredHeight = useCallback((id: string, height: number) => {
    const nextHeight = Math.max(1, Math.ceil(height));
    const currentHeight = measuredHeightsRef.current.get(id);
    if (currentHeight === nextHeight) {
      return;
    }
    measuredHeightsRef.current.set(id, nextHeight);
    setMeasurementVersion((current) => current + 1);
  }, []);

  const updateVirtualMetrics = useCallback((offsets: readonly number[], heights: readonly number[]) => {
    rowOffsetsRef.current = offsets;
    rowHeightsRef.current = heights;
  }, []);

  const completePendingScroll = useCallback((behavior: ScrollBehavior = "smooth") => {
    const pendingTarget = pendingScrollTargetRef.current;
    const pane = timelinePaneRef.current;
    if (!pendingTarget || !pane) {
      return false;
    }
    const row = pane.querySelector<HTMLElement>(`[data-transcript-item-id="${cssEscape(pendingTarget.itemId)}"]`);
    if (!row) {
      return false;
    }
    row.scrollIntoView({ block: "center", behavior });
    pendingScrollTargetRef.current = null;
    return true;
  }, [timelinePaneRef]);

  const scrollToTranscriptIndex = useCallback((index: number, itemId: string) => {
    const pane = timelinePaneRef.current;
    if (!pane) {
      return;
    }
    const mountedRow = pane.querySelector<HTMLElement>(`[data-transcript-item-id="${cssEscape(itemId)}"]`);
    if (mountedRow) {
      mountedRow.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }

    pendingScrollTargetRef.current = { itemId, index };
    const offsets = rowOffsetsRef.current;
    const estimatedTop = offsets[index] ?? estimateTranscriptOffset(transcript, index, measuredHeightsRef.current);
    pane.scrollTo({ top: Math.max(0, estimatedTop - pane.clientHeight * 0.28), behavior: "auto" });

    let attempts = 0;
    const retry = () => {
      attempts += 1;
      if (completePendingScroll(attempts > 1 ? "auto" : "smooth") || attempts >= 12) {
        return;
      }
      window.requestAnimationFrame(retry);
    };
    window.requestAnimationFrame(retry);
  }, [completePendingScroll, timelinePaneRef, transcript]);

  const estimatedRowOffsets = useMemo(
    () => buildTranscriptOffsets(transcript, measuredHeightsRef.current),
    [measurementVersion, transcript],
  );

  const syncActiveNavItem = useCallback(() => {
    const pane = timelinePaneRef.current;
    if (!pane || timelineNavItems.length === 0) {
      setActiveNavItemId(null);
      return;
    }

    const offsets = rowOffsetsRef.current.length === transcript.length ? rowOffsetsRef.current : estimatedRowOffsets;
    const closest = findClosestNavItem(timelineNavItems, offsets, pane.scrollTop + pane.clientHeight * 0.32);
    setActiveNavItemId((current) => (current === closest?.id ? current : closest?.id ?? null));
  }, [estimatedRowOffsets, timelineNavItems, timelinePaneRef, transcript.length]);

  const scheduleActiveNavSync = useCallback(() => {
    if (activeNavFrameRef.current !== null) return;
    activeNavFrameRef.current = window.requestAnimationFrame(() => {
      activeNavFrameRef.current = null;
      syncActiveNavItem();
    });
  }, [syncActiveNavItem]);

  useEffect(() => {
    scheduleActiveNavSync();
    return () => {
      if (activeNavFrameRef.current !== null) {
        window.cancelAnimationFrame(activeNavFrameRef.current);
        activeNavFrameRef.current = null;
      }
    };
  }, [measurementVersion, scheduleActiveNavSync, transcript]);

  const assignTimelinePaneRef = useCallback((node: HTMLDivElement | null) => {
    timelinePaneRef.current = node;
    timelinePaneElementRef?.(node);
  }, [timelinePaneElementRef, timelinePaneRef]);

  return (
    <div className="timeline-pane-shell timeline-pane-shell--thread">
      <div
        className="timeline-pane timeline-pane--thread"
        data-testid="timeline-pane"
        ref={assignTimelinePaneRef}
        onScroll={() => {
          onTimelineScroll();
          scheduleActiveNavSync();
          completePendingScroll("auto");
        }}
      >
        {threadSearch.isOpen ? (
          <ThreadSearchBar
            query={threadSearch.query}
            matchCount={threadSearch.matchCount}
            activeIndex={threadSearch.activeIndex}
            inputRef={threadSearch.inputRef}
            onSearch={threadSearch.search}
            onNext={() => threadSearch.goToMatch(1)}
            onPrev={() => threadSearch.goToMatch(-1)}
            onClose={threadSearch.close}
          />
        ) : null}
        {isTranscriptLoading ? (
          <div className="timeline" data-testid="transcript">
            <div className="timeline-empty">Loading transcript…</div>
          </div>
        ) : transcript.length === 0 ? (
          <div className="timeline" data-testid="transcript">
            <div className="timeline-empty">Send a prompt to start the session.</div>
          </div>
        ) : shouldVirtualize ? (
          <VirtualizedTranscriptList
            transcript={transcript}
            timelinePaneRef={timelinePaneRef}
            onContentHeightChange={onContentHeightChange}
            measuredHeightsRef={measuredHeightsRef}
            measurementVersion={measurementVersion}
            expandedToolCallIds={expandedToolCallIds}
            onHeightChange={updateMeasuredHeight}
            onToggleToolCall={toggleToolCall}
            onViewFileInDiff={onViewFileInDiff}
            onVirtualMetricsChange={updateVirtualMetrics}
          />
        ) : (
          <div className="timeline" data-testid="transcript">
            {transcript.map((item) => (
              <MeasuredTimelineItem
                item={item}
                key={item.id}
                onHeightChange={updateMeasuredHeight}
                expandedToolCallIds={expandedToolCallIds}
                onToggleToolCall={toggleToolCall}
                onViewFileInDiff={onViewFileInDiff}
              />
            ))}
          </div>
        )}
        {showJumpToLatest ? (
          <button className="timeline-jump" data-testid="timeline-jump" type="button" onClick={onJumpToLatest}>
            Return to bottom
          </button>
        ) : null}
      </div>
      {timelineNavItems.length > 1 ? (
        <ConversationTimelineNav
          activeItemId={activeNavItemId}
          items={timelineNavItems}
          transcript={transcript}
          onSelect={(item) => scrollToTranscriptIndex(item.index, item.itemId)}
        />
      ) : null}
    </div>
  );
}

export const ConversationTimeline = memo(ConversationTimelineComponent);

function VirtualizedTranscriptList({
  transcript,
  timelinePaneRef,
  onContentHeightChange,
  measuredHeightsRef,
  measurementVersion,
  expandedToolCallIds,
  onHeightChange,
  onToggleToolCall,
  onViewFileInDiff,
  onVirtualMetricsChange,
}: {
  readonly transcript: readonly TranscriptMessage[];
  readonly timelinePaneRef: MutableRefObject<HTMLDivElement | null>;
  readonly onContentHeightChange: () => void;
  readonly measuredHeightsRef: MutableRefObject<Map<string, number>>;
  readonly measurementVersion: number;
  readonly expandedToolCallIds: ReadonlySet<string>;
  readonly onHeightChange: (id: string, height: number) => void;
  readonly onToggleToolCall: (callId: string) => void;
  readonly onViewFileInDiff?: (path: string) => void;
  readonly onVirtualMetricsChange: (offsets: readonly number[], heights: readonly number[]) => void;
}) {
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 });
  const previousTotalHeightRef = useRef(0);
  void measurementVersion;

  useLayoutEffect(() => {
    const pane = timelinePaneRef.current;
    if (!pane) {
      return undefined;
    }

    const syncViewport = () => {
      const nextScrollTop = pane.scrollTop;
      const nextHeight = pane.clientHeight;
      setViewport((current) =>
        current.scrollTop === nextScrollTop && current.height === nextHeight
          ? current
          : { scrollTop: nextScrollTop, height: nextHeight },
      );
    };

    syncViewport();
    pane.addEventListener("scroll", syncViewport, { passive: true });
    const resizeObserver = new ResizeObserver(() => {
      syncViewport();
    });
    resizeObserver.observe(pane);

    return () => {
      pane.removeEventListener("scroll", syncViewport);
      resizeObserver.disconnect();
    };
  }, [timelinePaneRef]);

  const rowHeights = transcript.map((item) => measuredHeightsRef.current.get(item.id) ?? estimateTimelineItemHeight(item));
  const rowOffsets: number[] = [];
  let totalHeight = 0;
  for (const [index, rowHeight] of rowHeights.entries()) {
    rowOffsets[index] = totalHeight;
    totalHeight += rowHeight;
    if (index < rowHeights.length - 1) {
      totalHeight += ROW_GAP_PX;
    }
  }
  onVirtualMetricsChange(rowOffsets, rowHeights);

  useLayoutEffect(() => {
    if (previousTotalHeightRef.current === totalHeight) {
      return;
    }
    previousTotalHeightRef.current = totalHeight;
    onContentHeightChange();
  }, [onContentHeightChange, totalHeight]);

  const startOffset = Math.max(0, viewport.scrollTop - OVERSCAN_PX);
  const endOffset = viewport.scrollTop + viewport.height + OVERSCAN_PX;
  const startIndex = findStartIndex(rowOffsets, rowHeights, startOffset);
  const endIndex = findEndIndex(rowOffsets, endOffset);

  return (
    <div className="timeline timeline--virtualized" data-testid="transcript" style={{ height: `${totalHeight}px` }}>
      {transcript.slice(startIndex, endIndex).map((item, offsetIndex) => {
        const index = startIndex + offsetIndex;
        return (
          <MeasuredTimelineItem
            item={item}
            key={item.id}
            className="timeline__virtual-row"
            top={rowOffsets[index] ?? 0}
            onHeightChange={onHeightChange}
            expandedToolCallIds={expandedToolCallIds}
            onToggleToolCall={onToggleToolCall}
            onViewFileInDiff={onViewFileInDiff}
          />
        );
      })}
    </div>
  );
}

const MeasuredTimelineItem = memo(function MeasuredTimelineItem({
  item,
  className,
  top,
  onHeightChange,
  expandedToolCallIds,
  onToggleToolCall,
  onViewFileInDiff,
}: {
  readonly item: TranscriptMessage;
  readonly className?: string;
  readonly top?: number;
  readonly onHeightChange: (id: string, height: number) => void;
  readonly expandedToolCallIds: ReadonlySet<string>;
  readonly onToggleToolCall: (callId: string) => void;
  readonly onViewFileInDiff?: (path: string) => void;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = rowRef.current;
    if (!element) {
      return undefined;
    }

    const measure = () => {
      onHeightChange(item.id, element.getBoundingClientRect().height);
    };

    measure();
    const resizeObserver = new ResizeObserver(() => {
      measure();
    });
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, [item.id, onHeightChange]);

  return (
    <div
      className={className}
      data-transcript-item-id={item.id}
      ref={rowRef}
      style={top == null ? undefined : { transform: `translateY(${top}px)` }}
    >
      <TimelineItem
        item={item}
        expandedToolCallIds={expandedToolCallIds}
        onToggleToolCall={onToggleToolCall}
        onViewFileInDiff={onViewFileInDiff}
      />
    </div>
  );
});

function ConversationTimelineNav({
  activeItemId,
  items,
  transcript,
  onSelect,
}: {
  readonly activeItemId: string | null;
  readonly items: readonly ConversationTimelineNavItem[];
  readonly transcript: readonly TranscriptMessage[];
  readonly onSelect: (item: ConversationTimelineNavItem) => void;
}) {
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const denominator = Math.max(items.length - 1, 1);
  const hoveredItem = items.find((item) => item.id === hoveredItemId);
  const hoveredItemIndex = hoveredItem ? items.findIndex((item) => item.id === hoveredItem.id) : -1;

  const updateHoverFromPointer = (clientY: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const progress = Math.max(0, Math.min(1, (clientY - rect.top - 8) / Math.max(1, rect.height - 16)));
    const nextIndex = Math.max(0, Math.min(items.length - 1, Math.round(progress * denominator)));
    setHoveredItemId(items[nextIndex]?.id ?? null);
  };

  return (
    <nav
      className="conversation-nav"
      aria-label="Conversation timeline"
      data-testid="conversation-nav"
      onMouseEnter={(event) => updateHoverFromPointer(event.clientY, event.currentTarget)}
      onMouseMove={(event) => updateHoverFromPointer(event.clientY, event.currentTarget)}
      onMouseLeave={() => setHoveredItemId(null)}
    >
      <div className="conversation-nav__rail" aria-hidden="true" />
      {items.map((item, itemIndex) => {
        const isActive = activeItemId === item.id;
        const isHovered = hoveredItemId === item.id;
        return (
          <div
            className={`conversation-nav__item ${isActive ? "conversation-nav__item--active" : ""} ${isHovered ? "conversation-nav__item--hovered" : ""}`}
            key={item.id}
            style={{ "--timeline-nav-progress": itemIndex / denominator } as CSSProperties}
          >
            <button
              aria-label={item.label}
              className="conversation-nav__trigger"
              type="button"
              title={item.label}
              onClick={() => onSelect(item)}
              onFocus={() => setHoveredItemId(item.id)}
            >
              <span className="conversation-nav__pill" aria-hidden="true" />
            </button>
          </div>
        );
      })}
      {hoveredItem ? (
        <ConversationNavPopover
          item={hoveredItem}
          items={items}
          transcript={transcript}
          onSelect={onSelect}
          progress={Math.max(0, hoveredItemIndex) / denominator}
        />
      ) : null}
    </nav>
  );
}

function ConversationNavPopover({
  item,
  items,
  transcript,
  onSelect,
  progress,
}: {
  readonly item: ConversationTimelineNavItem;
  readonly items: readonly ConversationTimelineNavItem[];
  readonly transcript: readonly TranscriptMessage[];
  readonly onSelect: (item: ConversationTimelineNavItem) => void;
  readonly progress: number;
}) {
  const rows = getConversationNavPopoverRows(transcript, item.index);
  const placement = progress > 0.74 ? "above" : progress < 0.18 ? "below" : "center";
  return (
    <span
      className={`conversation-nav__popover conversation-nav__popover--${placement}`}
      role="tooltip"
      style={{ "--timeline-popover-y": progress } as CSSProperties}
    >
      <span className="conversation-nav__popover-list">
        {rows.map((row) => {
          const targetItem = items.find((candidate) => candidate.index === row.index);
          return (
            <button
              className={`conversation-nav__popover-row ${row.current ? "conversation-nav__popover-row--current" : ""}`}
              key={`${row.index}:${row.label}`}
              type="button"
              onClick={() => {
                if (targetItem) {
                  onSelect(targetItem);
                }
              }}
            >
              <span className="conversation-nav__popover-text">{row.label}</span>
            </button>
          );
        })}
      </span>
    </span>
  );
}

function buildConversationTimelineNavItems(transcript: readonly TranscriptMessage[]): readonly ConversationTimelineNavItem[] {
  let ordinal = 0;
  return transcript.flatMap((item, index) => {
    const navKind = getConversationNavKind(item);
    if (!navKind) {
      return [];
    }
    ordinal += 1;
    return [{
      id: `${item.id}:${navKind}`,
      itemId: item.id,
      index,
      kind: navKind,
      label: getConversationNavLabel(ordinal),
      detail: getConversationNavDetail(item),
      ordinal,
    }];
  });
}

function getConversationNavKind(item: TranscriptMessage): ConversationTimelineNavItem["kind"] | null {
  return item.kind === "message" && item.role === "user" ? "user" : null;
}

function getConversationNavLabel(ordinal: number): string {
  return `Item ${ordinal}`;
}

function getConversationNavDetail(_item: TranscriptMessage): string | undefined {
  return undefined;
}

function getConversationNavPopoverRows(transcript: readonly TranscriptMessage[], targetIndex: number): Array<{
  readonly index: number;
  readonly label: string;
  readonly current: boolean;
}> {
  const messageRows = transcript
    .map((item, index) => ({ item, index }))
    .filter((entry): entry is { readonly item: Extract<TranscriptMessage, { kind: "message" }>; readonly index: number } =>
      entry.item.kind === "message" && entry.item.role === "user",
    );
  const targetMessageIndex = messageRows.findIndex((entry) => entry.index === targetIndex);
  const safeTargetIndex = targetMessageIndex >= 0 ? targetMessageIndex : 0;
  const start = Math.max(0, Math.min(messageRows.length - 7, safeTargetIndex - 3));
  return messageRows.slice(start, start + 7).map(({ item, index }) => ({
    index,
    label: compactPopoverText(item.text),
    current: index === targetIndex,
  }));
}

function compactPopoverText(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "Empty message";
  }
  return compact.length > 76 ? `${compact.slice(0, 73)}…` : compact;
}

function buildTranscriptOffsets(
  transcript: readonly TranscriptMessage[],
  measuredHeights: ReadonlyMap<string, number>,
): readonly number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const [index, item] of transcript.entries()) {
    offsets[index] = offset;
    offset += measuredHeights.get(item.id) ?? estimateTimelineItemHeight(item);
    offset += ROW_GAP_PX;
  }
  return offsets;
}

function estimateTranscriptOffset(
  transcript: readonly TranscriptMessage[],
  index: number,
  measuredHeights: ReadonlyMap<string, number>,
): number {
  return buildTranscriptOffsets(transcript, measuredHeights)[index] ?? 0;
}

function findClosestNavItem(
  items: readonly ConversationTimelineNavItem[],
  offsets: readonly number[],
  targetOffset: number,
): ConversationTimelineNavItem | undefined {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if ((offsets[items[mid]?.index ?? 0] ?? 0) < targetOffset) low = mid + 1;
    else high = mid;
  }
  const before = items[Math.max(0, low - 1)];
  const after = items[Math.min(items.length - 1, low)];
  if (!before) return after;
  if (!after) return before;
  return Math.abs((offsets[before.index] ?? 0) - targetOffset) <= Math.abs((offsets[after.index] ?? 0) - targetOffset)
    ? before
    : after;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

function findStartIndex(offsets: readonly number[], heights: readonly number[], targetOffset: number): number {
  let low = 0;
  let high = offsets.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const end = (offsets[mid] ?? 0) + (heights[mid] ?? 0);
    if (end < targetOffset) {
      low = mid + 1;
      continue;
    }
    high = mid - 1;
  }

  return Math.max(0, Math.min(offsets.length - 1, low));
}

function findEndIndex(offsets: readonly number[], targetOffset: number): number {
  if (offsets.length === 0) {
    return 0;
  }

  let low = 0;
  let high = offsets.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if ((offsets[mid] ?? 0) <= targetOffset) {
      low = mid + 1;
      continue;
    }
    high = mid - 1;
  }

  const lastVisibleIndex = Math.max(0, low);
  return Math.min(offsets.length, Math.max(lastVisibleIndex + 1, 1));
}

function estimateTimelineItemHeight(item: TranscriptMessage): number {
  if (item.kind === "message") {
    const attachmentHeight = item.attachments?.some((attachment) => attachment.kind === "image")
      ? 120
      : item.attachments?.length
        ? 56
        : 0;
    const textLength = Math.max(item.text.length, 1);
    return 48 + attachmentHeight + Math.min(240, Math.ceil(textLength / 90) * 20);
  }
  if (item.kind === "tool") {
    return 52;
  }
  if (item.kind === "summary") {
    return item.presentation === "divider" ? 44 : 38;
  }
  return 38;
}
