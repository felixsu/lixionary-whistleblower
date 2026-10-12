import clsx from "clsx";
import { AlertCircle, CheckCircle2, Info, Loader2 } from "lucide-react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "primary",
  loading,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx("ds-button", `ds-button-${variant}`, className)}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

const fieldBase = "ds-field";

export function Input({
  className,
  invalid,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      className={clsx(fieldBase, invalid && "border-danger", className)}
    />
  );
}

export function Textarea({
  className,
  invalid,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      {...props}
      aria-invalid={invalid || undefined}
      className={clsx(
        fieldBase,
        "min-h-24 resize-y",
        invalid && "border-danger",
        className,
      )}
    />
  );
}

export function Select({
  className,
  invalid,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      {...props}
      aria-invalid={invalid || undefined}
      className={clsx(fieldBase, "pr-8", invalid && "border-danger", className)}
    />
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={clsx("ds-card", className)}>{children}</div>;
}

type Tone = "info" | "danger" | "warn" | "ok";
const tones: Record<Tone, { cls: string; Icon: typeof Info }> = {
  info: { cls: "bg-accent-soft text-ink", Icon: Info },
  danger: { cls: "bg-danger-soft text-danger", Icon: AlertCircle },
  warn: { cls: "bg-warn-soft text-warn", Icon: AlertCircle },
  ok: { cls: "bg-ok-soft text-ok", Icon: CheckCircle2 },
};

export function Alert({
  tone = "info",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  const { cls, Icon } = tones[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={clsx(
        "flex gap-2.5 rounded-lg px-3.5 py-3 text-sm",
        cls,
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: Tone | "neutral";
  children: ReactNode;
}) {
  return (
    <span className={clsx("ds-badge", `ds-badge-${tone}`)}>{children}</span>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {label}…
    </div>
  );
}

export function CompletenessMeter({ value }: { value: number }) {
  const tone = value >= 75 ? "bg-ok" : value >= 45 ? "bg-warn" : "bg-danger";
  return (
    <div className="flex items-center gap-2" title={`${value}% complete`}>
      <div
        className="h-1.5 w-full min-w-16 overflow-hidden rounded-full bg-sunken"
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Completeness"
      >
        <div
          className={clsx("h-full rounded-full transition-all", tone)}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="w-9 text-right text-xs tabular-nums text-muted">
        {value}%
      </span>
    </div>
  );
}
