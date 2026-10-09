import Link from "next/link";
import { EyeOff, KeyRound, MessagesSquare, ShieldCheck } from "lucide-react";

const steps = [
  {
    Icon: MessagesSquare,
    title: "Describe what happened",
    body: "Chat with our assistant or fill in a form. The assistant asks follow-up questions so nothing important is missed.",
  },
  {
    Icon: ShieldCheck,
    title: "Review and submit",
    body: "Check the structured report, attach evidence if you have it, and leave an email or phone number for follow-up.",
  },
  {
    Icon: KeyRound,
    title: "Keep your case code and PIN",
    body: "Use them to check progress and answer questions from the review team — without creating an account.",
  },
];

export default function HomePage() {
  return (
    <div className="space-y-14">
      <section className="max-w-2xl space-y-5">
        <p className="text-sm font-medium text-accent">Confidential reporting channel</p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Seen something that isn&apos;t right? Tell us safely.
        </h1>
        <p className="text-base leading-relaxed text-muted text-pretty">
          Report fraud, corruption, harassment, safety risks or other misconduct. Only the integrity team can read your
          report, and your contact details are encrypted and used only to follow up with you.
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          <Link
            href="/report"
            className="inline-flex items-center rounded-lg bg-accent px-5 py-3 text-sm font-medium text-accent-ink hover:opacity-90"
          >
            Make a report
          </Link>
          <Link
            href="/status"
            className="inline-flex items-center rounded-lg border border-line bg-surface px-5 py-3 text-sm font-medium hover:bg-sunken"
          >
            Check an existing report
          </Link>
        </div>
      </section>

      <section aria-labelledby="how" className="space-y-5">
        <h2 id="how" className="text-lg font-semibold">
          How it works
        </h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {steps.map(({ Icon, title, body }, i) => (
            <li key={title} className="rounded-2xl border border-line bg-surface p-5">
              <div className="mb-3 flex items-center gap-2 text-sm text-muted">
                <span className="flex size-6 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                  {i + 1}
                </span>
                <Icon className="size-4" aria-hidden />
              </div>
              <h3 className="font-medium">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex gap-3 rounded-2xl bg-sunken p-5 text-sm leading-relaxed text-muted">
        <EyeOff className="mt-0.5 size-5 shrink-0 text-ink" aria-hidden />
        <div className="space-y-1.5">
          <p className="font-medium text-ink">Protecting your identity</p>
          <p>
            Use a personal device and network if you can. Avoid including your own name in the report text, and remember
            that documents can contain author information in their properties. Photos you upload have their location and
            camera data removed automatically.
          </p>
        </div>
      </section>
    </div>
  );
}
