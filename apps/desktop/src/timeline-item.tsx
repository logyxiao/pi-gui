import { lazy, memo, Suspense } from "react";
import type { SessionTranscriptMessage } from "@pi-gui/pi-sdk-driver";
import type { TimelineActivity, TimelineToolCall, TimelineSummary, TranscriptMessage } from "./timeline-types";
import { MessageMarkdown } from "./message-markdown";
import { extractDiffFromOutput } from "./diff-output";
import { ChevronRightIcon, CopyIcon, DiffIcon, FileIcon } from "./icons";
import { useI18n, type I18nContextValue } from "./i18n";
import { extensionToLanguage } from "./syntax-language";

const InlineDiff = lazy(() => import("./diff-inline").then(({ InlineDiff }) => ({ default: InlineDiff })));

function TimelineItemComponent({
  item,
  expandedToolCallIds,
  onToggleToolCall,
  onViewFileInDiff,
}: {
  readonly item: TranscriptMessage;
  readonly expandedToolCallIds?: ReadonlySet<string>;
  readonly onToggleToolCall?: (callId: string) => void;
  readonly onViewFileInDiff?: (path: string) => void;
}) {
  switch (item.kind) {
    case "message":
      return <TimelineMessage item={item} />;
    case "activity":
      return <TimelineActivityItem item={item} />;
    case "tool":
      return (
        <TimelineToolCallItem
          item={item}
          expanded={expandedToolCallIds?.has(item.callId) ?? false}
          onToggle={onToggleToolCall}
          onViewFileInDiff={onViewFileInDiff}
        />
      );
    case "summary":
      return <TimelineSummaryItem item={item} />;
    default:
      return null;
  }
}

export const TimelineItem = memo(TimelineItemComponent);

function TimelineMessage({ item }: { readonly item: SessionTranscriptMessage }) {
  if (item.role === "user") {
    return (
      <article className="timeline-item timeline-item--user">
        <div className="timeline-item__bubble">
          {item.attachments?.length ? (
            <div className="timeline-item__attachments">
              {item.attachments.map((attachment, index) =>
                attachment.kind === "image" ? (
                  <img
                    alt={attachment.name ?? `Attachment ${index + 1}`}
                    className="timeline-item__attachment timeline-item__attachment--image"
                    key={`${item.id}:${index}`}
                    src={`data:${attachment.mimeType};base64,${attachment.data}`}
                  />
                ) : (
                  <div
                    className="timeline-item__attachment timeline-item__attachment--file"
                    key={`${item.id}:${index}`}
                    title={attachment.fsPath}
                  >
                    <span className="timeline-item__attachment-icon" aria-hidden="true">
                      <FileIcon />
                    </span>
                    <span className="timeline-item__attachment-name">{attachment.name}</span>
                  </div>
                ),
              )}
            </div>
          ) : null}
          <MessageMarkdown text={item.text} />
        </div>
      </article>
    );
  }

  if (item.role === "branchSummary" || item.role === "compactionSummary") {
    return (
      <article className="timeline-item timeline-item--summary-card">
        <div className="timeline-item__summary-eyebrow">
          {item.role === "branchSummary" ? "Branch summary" : "Compaction summary"}
        </div>
        <MessageMarkdown text={item.text} />
      </article>
    );
  }

  return (
    <article className="timeline-item timeline-item--assistant">
      <MessageMarkdown text={item.text} />
    </article>
  );
}

function TimelineActivityItem({ item }: { readonly item: TimelineActivity }) {
  const { t } = useI18n();
  const isWorking = isWorkingTimelineLabel(item.label);
  return (
    <div className={`timeline-activity timeline-activity--${item.tone ?? "neutral"} ${isWorking ? "timeline-activity--working" : ""}`}>
      {isWorking ? (
        <span className="timeline-activity__collision" aria-hidden="true">
          <span />
          <span />
        </span>
      ) : null}
      <span className="timeline-activity__label">{localizeTimelineLabel(item.label, t)}</span>
      {item.detail ? <span className="timeline-activity__detail">{item.detail}</span> : null}
      {item.metadata ? <span className="timeline-activity__meta">{localizeTimelineLabel(item.metadata, t)}</span> : null}
    </div>
  );
}

function TimelineToolCallItem({
  item,
  expanded,
  onToggle,
  onViewFileInDiff,
}: {
  readonly item: TimelineToolCall;
  readonly expanded: boolean;
  readonly onToggle?: (callId: string) => void;
  readonly onViewFileInDiff?: (path: string) => void;
}) {
  const hasContent = item.input !== undefined || item.output !== undefined;
  const diffText = isWriteTool(item.toolName) ? extractDiffFromOutput(item.output) : undefined;
  const diffStats = diffText ? countDiffStats(diffText) : undefined;
  const compactLabel = buildCompactLabel(item, diffStats);
  const filePath = isWriteTool(item.toolName) ? extractFilename(item.input) || undefined : undefined;
  const diffLanguage = diffText && filePath ? extensionToLanguage(filePath) : undefined;

  const handleCopy = () => {
    const text = diffText ?? formatToolContent(item.input, item.output);
    void navigator.clipboard.writeText(text);
  };

  return (
    <article className={`timeline-tool timeline-tool--${item.status}`}>
      <div className="timeline-tool__header-row">
        <button
          className="timeline-tool__header"
          type="button"
          aria-expanded={expanded}
          disabled={!hasContent}
          onClick={() => onToggle?.(item.callId)}
        >
          {hasContent ? (
            <span className={`timeline-tool__chevron ${expanded ? "timeline-tool__chevron--expanded" : ""}`}>
              <ChevronRightIcon />
            </span>
          ) : null}
          <span className="timeline-tool__label">{compactLabel}</span>
          {diffStats ? (
            <span className="timeline-tool__diff-stats">
              <span className="timeline-tool__stat-add">+{diffStats.added}</span>
              {" "}
              <span className="timeline-tool__stat-del">-{diffStats.removed}</span>
            </span>
          ) : null}
          <span className="timeline-tool__meta-inline">{`${item.toolName} \u00b7 ${statusLabel(item.status)}`}</span>
        </button>
        {filePath && onViewFileInDiff ? (
          <button
            aria-label={`View ${filePath} in changes`}
            className="icon-button timeline-tool__view-in-diff"
            data-testid="timeline-tool-view-in-diff"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onViewFileInDiff(filePath);
            }}
          >
            <DiffIcon />
          </button>
        ) : null}
      </div>
      {expanded && hasContent ? (
        <div className="timeline-tool__body">
          {diffText ? (
            <>
              <div className="timeline-tool__diff-header">
                <span className="timeline-tool__diff-filename">
                  {extractFilename(item.input)}
                  {diffStats ? (
                    <span className="timeline-tool__diff-stats">
                      {" "}<span className="timeline-tool__stat-add">+{diffStats.added}</span>
                      {" "}<span className="timeline-tool__stat-del">-{diffStats.removed}</span>
                    </span>
                  ) : null}
                </span>
                <button className="icon-button timeline-tool__copy" type="button" onClick={handleCopy} aria-label="Copy">
                  <CopyIcon />
                </button>
              </div>
              <Suspense fallback={<pre className="diff-inline">{diffText}</pre>}>
                <InlineDiff diff={diffText} language={diffLanguage} />
              </Suspense>
            </>
          ) : (
            <>
              <div className="timeline-tool__body-actions">
                <button className="icon-button timeline-tool__copy" type="button" onClick={handleCopy} aria-label="Copy">
                  <CopyIcon />
                </button>
              </div>
              <pre className="timeline-tool__pre">{formatToolContent(item.input, item.output)}</pre>
            </>
          )}
        </div>
      ) : null}
    </article>
  );
}

function isWriteTool(toolName: string): boolean {
  return /write|edit|patch|apply/i.test(toolName);
}

function buildCompactLabel(item: TimelineToolCall, diffStats: { added: number; removed: number } | undefined): string {
  if (isWriteTool(item.toolName)) {
    const filename = extractFilename(item.input);
    if (filename) {
      return `Edited ${shortenPath(filename)}`;
    }
  }
  return item.label;
}

function extractFilename(input: unknown): string {
  if (typeof input === "object" && input !== null) {
    const record = input as Record<string, unknown>;
    const path = record.file_path ?? record.filePath ?? record.path ?? record.filename;
    if (typeof path === "string") {
      return path;
    }
  }
  return "";
}

function shortenPath(filePath: string): string {
  // Show last 2-3 path segments for readability
  const parts = filePath.split("/");
  if (parts.length <= 3) {
    return filePath;
  }
  return parts.slice(-3).join("/");
}

function countDiffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removed += 1;
    }
  }
  return { added, removed };
}

function formatToolContent(input: unknown, output: unknown): string {
  const parts: string[] = [];
  if (input !== undefined) {
    parts.push(typeof input === "string" ? input : JSON.stringify(input, null, 2));
  }
  if (output !== undefined) {
    parts.push(typeof output === "string" ? output : JSON.stringify(output, null, 2));
  }
  return parts.join("\n\n");
}

function statusLabel(status: "running" | "success" | "error") {
  if (status === "running") return "running";
  if (status === "success") return "done";
  return "failed";
}

function TimelineSummaryItem({ item }: { readonly item: TimelineSummary }) {
  const { t } = useI18n();
  const label = localizeTimelineLabel(item.label, t);
  const metadata = item.metadata ? localizeTimelineLabel(item.metadata, t) : undefined;

  if (item.presentation === "divider") {
    return (
      <div className="timeline-summary">
        <span>{label}</span>
        {metadata ? <span className="timeline-summary__meta">{metadata}</span> : null}
      </div>
    );
  }

  return (
    <div className="timeline-activity timeline-activity--summary">
      <span className="timeline-activity__label">{label}</span>
      {metadata ? <span className="timeline-activity__meta">{metadata}</span> : null}
    </div>
  );
}

function isWorkingTimelineLabel(label: string): boolean {
  return label === "Working…" || label === "Working...";
}

function localizeTimelineLabel(label: string, t: I18nContextValue["t"]): string {
  if (isWorkingTimelineLabel(label)) {
    return t("timeline.working");
  }

  const workingFor = /^Working for (.+)$/.exec(label);
  if (workingFor?.[1]) {
    return t("timeline.workingFor", { duration: localizeTimelineDuration(workingFor[1], t) });
  }

  const workedFor = /^Worked for (.+)$/.exec(label);
  if (workedFor?.[1]) {
    return t("timeline.workedFor", { duration: localizeTimelineDuration(workedFor[1], t) });
  }

  return localizeTimelineSummaryLabel(label, t);
}

function localizeTimelineSummaryLabel(label: string, t: I18nContextValue["t"]): string {
  return label.split(", ").map((part) => {
    const explored = /^Explored (\d+) files?$/.exec(part);
    if (explored?.[1]) {
      const count = Number(explored[1]);
      return t(count === 1 ? "timeline.exploredFile" : "timeline.exploredFiles", { count });
    }

    const searches = /^(\d+) search(?:es)?$/.exec(part);
    if (searches?.[1]) {
      const count = Number(searches[1]);
      return t(count === 1 ? "timeline.search" : "timeline.searches", { count });
    }

    const tools = /^Used (\d+) tools?$/.exec(part);
    if (tools?.[1]) {
      const count = Number(tools[1]);
      return t(count === 1 ? "timeline.usedTool" : "timeline.usedTools", { count });
    }

    if (part === "Completed") {
      return t("timeline.completed");
    }

    return part;
  }).join(t("timeline.summarySeparator"));
}

function localizeTimelineDuration(duration: string, t: I18nContextValue["t"]): string {
  const minutesSeconds = /^(\d+)m (\d+)s$/.exec(duration);
  if (minutesSeconds?.[1] && minutesSeconds[2]) {
    return t("timeline.durationMinutesSeconds", {
      minutes: Number(minutesSeconds[1]),
      seconds: Number(minutesSeconds[2]),
    });
  }

  const minutes = /^(\d+)m$/.exec(duration);
  if (minutes?.[1]) {
    return t("timeline.durationMinutes", { minutes: Number(minutes[1]) });
  }

  const seconds = /^(\d+)s$/.exec(duration);
  if (seconds?.[1]) {
    return t("timeline.durationSeconds", { seconds: Number(seconds[1]) });
  }

  return duration;
}
