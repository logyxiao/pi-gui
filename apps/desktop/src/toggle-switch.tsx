interface ToggleSwitchProps {
  readonly checked: boolean;
  readonly label: string;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly onChange: (checked: boolean) => void;
}

export function ToggleSwitch({ checked, label, disabled, className, onChange }: ToggleSwitchProps) {
  return (
    <button
      className={`toggle-switch${checked ? " toggle-switch--checked" : ""}${className ? ` ${className}` : ""}`}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!checked);
      }}
    >
      <span className="toggle-switch__track" aria-hidden="true">
        <span className="toggle-switch__thumb" />
      </span>
      <span className="sr-only">{label}</span>
    </button>
  );
}
