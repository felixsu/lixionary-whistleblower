import clsx from "clsx";
import { Check } from "lucide-react";

export type Step = "intro" | "chat" | "review" | "contact";

export function StepIndicator({ step, withChat }: { step: Step; withChat: boolean }) {
  const steps: { id: Step; label: string }[] = [
    ...(withChat ? [{ id: "chat" as const, label: "Describe" }] : []),
    { id: "review", label: "Review" },
    { id: "contact", label: "Contact & submit" },
  ];
  const current = steps.findIndex((s) => s.id === step);
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s.id} className="flex items-center gap-2">
          {i > 0 && <span className="h-px w-5 bg-line" aria-hidden />}
          <span
            aria-current={i === current ? "step" : undefined}
            className={clsx("flex items-center gap-1.5", i === current ? "font-medium text-ink" : "text-muted")}
          >
            <span
              className={clsx(
                "flex size-5 items-center justify-center rounded-full text-[11px] font-semibold",
                i < current ? "bg-accent text-accent-ink" : i === current ? "bg-accent-soft text-accent" : "bg-sunken text-muted",
              )}
            >
              {i < current ? <Check className="size-3" aria-hidden /> : i + 1}
            </span>
            {s.label}
          </span>
        </li>
      ))}
    </ol>
  );
}
