"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, ShieldCheck } from "lucide-react";
import type { AdminMe } from "@whistle/shared";
import { api, ApiError } from "@/lib/api";
import { Button, Spinner } from "@/components/ui";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<AdminMe>("/api/admin/me") });

  // Any 401 from the API means the session is gone.
  useEffect(() => {
    return queryClient.getQueryCache().subscribe((event) => {
      const err = event.query.state.error;
      if (err instanceof ApiError && err.status === 401) router.replace("/admin/login");
    });
  }, [queryClient, router]);

  async function logout() {
    await api("/api/admin/logout", { method: "POST" }).catch(() => {});
    queryClient.clear();
    router.replace("/admin/login");
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/admin" className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="size-5 text-accent" aria-hidden /> Review console
          </Link>
          {me.data && (
            <div className="flex items-center gap-2 text-sm">
              <span className="hidden text-muted sm:inline">{me.data.name}</span>
              <Button variant="ghost" onClick={logout} className="px-2.5">
                <LogOut className="size-4" aria-hidden /> Sign out
              </Button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{me.isPending ? <Spinner /> : me.data ? children : null}</main>
    </div>
  );
}
