const BUTTON_TOOLTIP_SELECTOR = "button,[role='button']";

function getButtonTooltip(button: HTMLElement) {
  const ariaLabel = button.getAttribute("aria-label")?.trim();
  if (ariaLabel) {
    return ariaLabel;
  }
  const text = button.textContent?.replace(/\s+/g, " ").trim();
  return text || undefined;
}

function ensureButtonTooltip(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return;
  }
  const button = target.closest<HTMLElement>(BUTTON_TOOLTIP_SELECTOR);
  if (!button || button.hasAttribute("title")) {
    return;
  }
  const tooltip = getButtonTooltip(button);
  if (tooltip) {
    button.setAttribute("title", tooltip);
    button.dataset.autoTooltip = "true";
  }
}

export function installButtonTooltips() {
  document.addEventListener("mouseover", (event) => ensureButtonTooltip(event.target), true);
  document.addEventListener("focusin", (event) => ensureButtonTooltip(event.target), true);
}
