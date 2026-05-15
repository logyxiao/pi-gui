import { useEffect, useMemo, useRef, useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import {
  buildModelOptions,
  MODEL_OPTIONS_EMPTY_DESCRIPTION,
  MODEL_OPTIONS_EMPTY_TITLE,
  THINKING_OPTIONS,
  type ComposerModelOption,
} from "./composer-commands";
import { useI18n } from "./i18n";

interface ModelSelectorProps {
  readonly runtime: RuntimeSnapshot | undefined;
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: string | undefined;
  readonly disabled?: boolean;
  readonly dropdownPlacement?: "above" | "below";
  readonly showEmptyModelControl?: boolean;
  readonly unselectedModelLabel?: string;
  readonly emptyModelLabel?: string;
  readonly emptyModelTitle?: string;
  readonly emptyModelDescription?: string;
  readonly onSetModel: (provider: string, modelId: string) => void;
  readonly onSetThinking: (level: string) => void;
}

type OpenDropdown = "none" | "model" | "thinking";

export function ModelSelector({
  runtime,
  provider,
  modelId,
  thinkingLevel,
  disabled,
  dropdownPlacement = "above",
  showEmptyModelControl = false,
  unselectedModelLabel = "Choose model",
  emptyModelLabel = "Choose model",
  emptyModelTitle = MODEL_OPTIONS_EMPTY_TITLE,
  emptyModelDescription = MODEL_OPTIONS_EMPTY_DESCRIPTION,
  onSetModel,
  onSetThinking,
}: ModelSelectorProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState<OpenDropdown>("none");
  const [query, setQuery] = useState("");
  const modelSearchRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLSpanElement | null>(null);

  const groupedModels = useMemo(() => groupByProvider(buildModelOptions(runtime), query), [runtime, query]);
  const hasModelControl = Boolean(provider && modelId) || groupedModels.length > 0;
  const shouldRenderModelControl = hasModelControl || showEmptyModelControl;
  const modelBadgeLabel = provider && modelId ? `${provider}:${modelId}` : groupedModels.length > 0 ? unselectedModelLabel : emptyModelLabel;

  useEffect(() => {
    if (open === "model") {
      window.requestAnimationFrame(() => modelSearchRef.current?.focus());
    }
    if (open === "none") return undefined;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen("none");
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen("none");
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  if (!shouldRenderModelControl && !thinkingLevel) {
    return null;
  }

  return (
    <span className="model-selector" ref={containerRef}>
      {shouldRenderModelControl ? (
        <span className="model-selector__anchor">
          <button
            className="model-selector__badge"
            type="button"
            disabled={disabled}
            onClick={() => setOpen(open === "model" ? "none" : "model")}
          >
            {modelBadgeLabel}
          </button>
          {open === "model" ? (
            <div
              className={`model-selector__dropdown ${dropdownPlacement === "below" ? "model-selector__dropdown--below" : ""}`}
              onWheel={(event) => event.stopPropagation()}
            >
              <div className="model-selector__search-wrap">
                <span aria-hidden="true" className="model-selector__search-icon">⌕</span>
                <input
                  ref={modelSearchRef}
                  aria-label={t("settings.models.searchModels")}
                  className="settings-search model-selector__search"
                  placeholder={t("settings.models.searchModels")}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div className="model-selector__scrollarea">
                {groupedModels.map((group) => (
                  <div key={group.provider}>
                    <div className="model-selector__group-title">{group.provider}</div>
                    {group.items.map((option) => {
                      const isActive = option.providerId === provider && option.modelId === modelId;
                      return (
                        <button
                          className={`model-selector__item${isActive ? " model-selector__item--active" : ""}`}
                          key={`${option.providerId}:${option.modelId}`}
                          type="button"
                          onClick={() => {
                            if (!isActive) onSetModel(option.providerId, option.modelId);
                            setOpen("none");
                          }}
                        >
                          <span className="model-selector__item-label">{option.label}</span>
                          {isActive ? <span className="model-selector__item-meta">{t("settings.models.active")}</span> : null}
                        </button>
                      );
                    })}
                  </div>
                ))}
                {groupedModels.length === 0 ? <div className="model-selector__empty">{emptyModelTitle}</div> : null}
              </div>
            </div>
          ) : null}
        </span>
      ) : null}
      {thinkingLevel ? (
        <span className="model-selector__anchor">
          <button
            className="model-selector__badge"
            type="button"
            disabled={disabled}
            onClick={() => setOpen(open === "thinking" ? "none" : "thinking")}
          >
            {thinkingLevel}
          </button>
          {open === "thinking" ? (
            <div className={`model-selector__dropdown ${dropdownPlacement === "below" ? "model-selector__dropdown--below" : ""}`} onWheel={(event) => event.stopPropagation()}>
              <div className="model-selector__group-title">{t("settings.models.thinkingLevel")}</div>
              {THINKING_OPTIONS.map((option) => {
                const isActive = option.value === thinkingLevel;
                return (
                  <button
                    className={`model-selector__item${isActive ? " model-selector__item--active" : ""}`}
                    key={option.value}
                    type="button"
                    onClick={() => {
                      if (!isActive) onSetThinking(option.value);
                      setOpen("none");
                    }}
                  >
                    <span className="model-selector__item-label">{option.label}</span>
                    <span className="model-selector__item-meta">{option.description}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

interface ModelGroup {
  readonly provider: string;
  readonly items: readonly ComposerModelOption[];
}

function groupByProvider(options: readonly ComposerModelOption[], query: string): readonly ModelGroup[] {
  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? options.filter((option) => [option.providerId, option.label, option.modelId].some((value) => value.toLowerCase().includes(normalized)))
    : options;
  const groups = new Map<string, ComposerModelOption[]>();
  for (const option of filtered) {
    const existing = groups.get(option.providerId);
    if (existing) existing.push(option);
    else groups.set(option.providerId, [option]);
  }
  return Array.from(groups.entries()).map(([provider, items]) => ({ provider, items }));
}
