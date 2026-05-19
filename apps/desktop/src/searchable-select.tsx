import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "./i18n";

export interface SearchableSelectOption {
  readonly value: string;
  readonly label: string;
  readonly meta?: string;
}

interface SearchableSelectProps {
  readonly value: string;
  readonly options: readonly SearchableSelectOption[];
  readonly placeholder: string;
  readonly searchPlaceholder?: string;
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly onChange: (value: string) => void;
}

interface FloatingRect {
  readonly left: number;
  readonly top?: number;
  readonly bottom?: number;
  readonly width: number;
}

export function SearchableSelect({
  value,
  options,
  placeholder,
  searchPlaceholder,
  ariaLabel,
  disabled,
  className,
  onChange,
}: SearchableSelectProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [floatingRect, setFloatingRect] = useState<FloatingRect | undefined>();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selected = options.find((option) => option.value === value);

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter((option) =>
      [option.label, option.value, option.meta ?? ""].some((entry) => entry.toLowerCase().includes(normalized)),
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return undefined;

    const updateFloatingRect = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportPadding = 12;
      const width = Math.min(Math.max(rect.width, 260), window.innerWidth - viewportPadding * 2);
      const left = Math.min(Math.max(rect.left, viewportPadding), window.innerWidth - width - viewportPadding);
      const spaceBelow = window.innerHeight - rect.bottom;
      const openAbove = spaceBelow < 280 && rect.top > spaceBelow;
      setFloatingRect({
        left,
        top: openAbove ? undefined : rect.bottom + 6,
        bottom: openAbove ? window.innerHeight - rect.top + 6 : undefined,
        width,
      });
    };

    updateFloatingRect();
    window.requestAnimationFrame(() => inputRef.current?.focus());

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const targetElement = target instanceof Element ? target : null;
      if (!rootRef.current?.contains(target) && !targetElement?.closest(".searchable-select__popover")) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("resize", updateFloatingRect);
    window.addEventListener("scroll", updateFloatingRect, true);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", updateFloatingRect);
      window.removeEventListener("scroll", updateFloatingRect, true);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const popover = open && floatingRect ? (
    <div
      className="searchable-select__popover"
      style={{
        left: floatingRect.left,
        top: floatingRect.top,
        bottom: floatingRect.bottom,
        width: floatingRect.width,
      }}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="searchable-select__search-wrap">
        <span className="searchable-select__search-icon" aria-hidden="true">⌕</span>
        <input
          ref={inputRef}
          className="settings-search searchable-select__search"
          placeholder={searchPlaceholder ?? placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="searchable-select__list">
        {filteredOptions.map((option) => {
          const active = option.value === value;
          return (
            <button
              className={`searchable-select__option${active ? " searchable-select__option--active" : ""}`}
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
                setQuery("");
              }}
            >
              <span className="searchable-select__option-label">{option.label}</span>
              {option.meta ? <span className="searchable-select__option-meta">{option.meta}</span> : null}
            </button>
          );
        })}
        {filteredOptions.length === 0 ? <div className="searchable-select__empty">{t("common.noResults")}</div> : null}
      </div>
    </div>
  ) : null;

  return (
    <div className={`searchable-select${className ? ` ${className}` : ""}`} ref={rootRef}>
      <button
        ref={buttonRef}
        className="searchable-select__button"
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={selected ? "searchable-select__label" : "searchable-select__placeholder"}>
          {selected?.label ?? placeholder}
        </span>
        <span className="searchable-select__chevron" aria-hidden="true" />
      </button>
      {popover ? createPortal(popover, document.body) : null}
    </div>
  );
}
