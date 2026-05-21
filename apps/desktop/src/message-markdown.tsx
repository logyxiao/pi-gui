import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyIcon } from "./icons";
import { useI18n } from "./i18n";

const REMARK_PLUGINS = [remarkGfm];

const MARKDOWN_COMPONENTS = {
  code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
    const language = className?.replace(/^language-/, "");
    const rawCode = String(children);
    const code = rawCode.replace(/\n$/, "");
    if (!className && !rawCode.includes("\n")) {
      return <code>{code}</code>;
    }
    return <MarkdownCodeBlock className={className} code={code} language={language} />;
  },
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} rel="noreferrer" target="_blank">
      {children}
    </a>
  ),
} as const;

function MarkdownCodeBlock({
  className,
  code,
  language,
}: {
  readonly className: string | undefined;
  readonly code: string;
  readonly language: string | undefined;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void copyTextToClipboard(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <div className="message-code-block">
      <button
        aria-label={copied ? t("common.copied") : t("common.copy")}
        className="icon-button message-code-block__copy"
        type="button"
        onClick={handleCopy}
      >
        <CopyIcon />
        <span>{copied ? t("common.copied") : t("common.copy")}</span>
      </button>
      <pre data-language={language}>
        <code className={className}>{code}</code>
      </pre>
    </div>
  );
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

export function MessageMarkdown({ text }: { readonly text: string }) {
  return (
    <div className="message__content">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
