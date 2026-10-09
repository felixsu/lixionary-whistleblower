"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { MessageCircle, Paperclip, Search } from "lucide-react";
import {
  CATEGORY_LABELS,
  REPORT_CATEGORIES,
  REPORT_STATUSES,
  STATUS_LABELS,
  type AdminReportList,
} from "@whistle/shared";
import { api, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { Alert, Badge, Button, CompletenessMeter, Input, Select, Spinner } from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";

const FILTER_KEYS = ["status", "category", "q", "from", "to", "page"] as const;

function ReportList() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  const query = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const v = params.get(key);
    if (v) query.set(key, v);
  }
  const page = Number(params.get("page") ?? 1);

  const list = useQuery({
    queryKey: ["reports", query.toString()],
    queryFn: () => api<AdminReportList>(`/api/admin/reports?${query}`),
    placeholderData: keepPreviousData,
  });

  function setFilter(key: (typeof FILTER_KEYS)[number], value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    router.replace(`${pathname}?${next}`);
  }

  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold">Reports</h1>
        {list.data && <p className="text-sm text-muted">{list.data.total} total</p>}
      </div>

      <div className="grid gap-3 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_auto_auto]">
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            setFilter("q", q.trim());
          }}
        >
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input aria-label="Search" placeholder="Case code or keyword" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </form>
        <Select aria-label="Status" value={params.get("status") ?? ""} onChange={(e) => setFilter("status", e.target.value)}>
          <option value="">All statuses</option>
          {REPORT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select aria-label="Category" value={params.get("category") ?? ""} onChange={(e) => setFilter("category", e.target.value)}>
          <option value="">All categories</option>
          {REPORT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </Select>
        <Input aria-label="From date" type="date" value={params.get("from") ?? ""} onChange={(e) => setFilter("from", e.target.value)} />
        <Input aria-label="To date" type="date" value={params.get("to") ?? ""} onChange={(e) => setFilter("to", e.target.value)} />
      </div>

      {list.isError && <Alert tone="danger">{errorMessage(list.error)}</Alert>}
      {list.isPending ? (
        <Spinner />
      ) : list.data && list.data.items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line py-12 text-center text-sm text-muted">No reports match these filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="border-b border-line text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Case</th>
                <th className="px-4 py-3 font-medium">Report</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="w-36 px-4 py-3 font-medium">Completeness</th>
                <th className="px-4 py-3 font-medium">Received</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.data?.items.map((r) => (
                <tr key={r.id} className="hover:bg-sunken/60">
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                    <Link href={`/admin/reports/${r.id}`} className="hover:text-accent">
                      {r.caseCode}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/reports/${r.id}`} className="font-medium hover:text-accent">
                      {r.title}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                      {CATEGORY_LABELS[r.category]}
                      {r.attachmentCount > 0 && (
                        <span className="inline-flex items-center gap-0.5">
                          <Paperclip className="size-3" aria-hidden /> {r.attachmentCount}
                        </span>
                      )}
                      {r.unreadReporterMessages > 0 && (
                        <Badge tone="warn">
                          <MessageCircle className="mr-1 size-3" aria-hidden /> {r.unreadReporterMessages} new
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3">
                    <CompletenessMeter value={r.completeness} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted">{formatDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setFilter("page", String(page - 1))}>
            Previous
          </Button>
          <span className="text-muted tabular-nums">
            {page} / {totalPages}
          </span>
          <Button variant="secondary" disabled={page >= totalPages} onClick={() => setFilter("page", String(page + 1))}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

export default function AdminReportsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ReportList />
    </Suspense>
  );
}
