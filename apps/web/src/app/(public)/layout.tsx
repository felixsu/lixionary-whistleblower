import { SiteHeader } from "@/components/site-header";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:py-12">{children}</main>
      <footer className="border-t border-line py-6 text-center text-xs text-muted">
        Reports are confidential. We never record your IP address, and you don&apos;t need an account.
      </footer>
    </div>
  );
}
