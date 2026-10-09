import Link from "next/link";
import { ShieldCheck } from "lucide-react";

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-surface/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="size-5 text-accent" aria-hidden />
          Speak Up
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/report" className="rounded-lg px-3 py-1.5 text-muted hover:bg-sunken hover:text-ink">
            Make a report
          </Link>
          <Link href="/status" className="rounded-lg px-3 py-1.5 text-muted hover:bg-sunken hover:text-ink">
            Check status
          </Link>
        </nav>
      </div>
    </header>
  );
}
