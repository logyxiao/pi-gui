import { useMemo, type ReactNode } from "react";
import { MAX_HIGHLIGHTED_LINES, highlightLine, type HighlightLine } from "./syntax-highlight";
export { extractDiffFromOutput } from "./diff-output";

interface DiffLine {
  readonly type: "added" | "removed" | "context" | "header";
  readonly content: string;
  readonly lineNumber?: number;
}

export function InlineDiff({
  diff,
  language,
}: {
  readonly diff: string;
  readonly language?: string;
}) {
  const lines = useMemo(() => parseDiff(diff), [diff]);
  const highlightActive = language !== undefined && lines.length <= MAX_HIGHLIGHTED_LINES;

  if (lines.length === 0) {
    return null;
  }

  return (
    <pre
      className="diff-inline"
      data-language={highlightActive ? language : undefined}
    >
      {lines.map((line, index) => (
        <div className={`diff-line diff-line--${line.type}`} key={index}>
          {line.lineNumber !== undefined ? (
            <span className="diff-line__number">{line.lineNumber}</span>
          ) : (
            <span className="diff-line__number" />
          )}
          <span className="diff-line__content">
            {highlightActive && line.type !== "header" ? (
              <HighlightedContent content={line.content} language={language!} />
            ) : (
              line.content
            )}
          </span>
        </div>
      ))}
    </pre>
  );
}

function HighlightedContent({
  content,
  language,
}: {
  readonly content: string;
  readonly language: string;
}) {
  const tokens = useMemo(() => highlightLine(content, language), [content, language]);
  return <>{renderTokens(tokens)}</>;
}

function renderTokens(tokens: HighlightLine): ReactNode {
  return tokens.map((token, index) =>
    typeof token === "string" ? (
      token
    ) : (
      <span className={token.className} key={index}>
        {renderTokens(token.children)}
      </span>
    ),
  );
}

function parseDiff(diff: string): DiffLine[] {
  const lines = diff.split("\n");
  const result: DiffLine[] = [];
  let lineNumber = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(line);
      lineNumber = match ? parseInt(match[1] ?? "0", 10) : 0;
      result.push({ type: "header", content: line });
      continue;
    }
    if (line.startsWith("---") || line.startsWith("+++")) {
      continue;
    }
    if (line.startsWith("+")) {
      result.push({ type: "added", content: line.slice(1), lineNumber });
      lineNumber += 1;
    } else if (line.startsWith("-")) {
      result.push({ type: "removed", content: line.slice(1) });
    } else if (line.startsWith(" ") || line === "") {
      result.push({ type: "context", content: line.slice(1), lineNumber });
      lineNumber += 1;
    }
  }

  return result;
}
