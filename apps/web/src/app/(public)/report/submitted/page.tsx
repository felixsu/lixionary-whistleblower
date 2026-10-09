"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, Download } from "lucide-react";
import type { SubmitReportResponse } from "@whistle/shared";
import { saveResult, savedResult } from "@/lib/intake";
import { Alert, Button, Card } from "@/components/ui";

export default function SubmittedPage() {
  const [result, setResult] = useState<SubmitReportResponse | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => setResult(savedResult()), []);

  if (result === undefined) return null;
  if (result === null) {
    return (
      <Card className="max-w-xl space-y-3">
        <h1 className="text-xl font-semibold">Nothing to show</h1>
        <p className="text-sm text-muted">
          Case details are only shown once, right after submitting. If you saved your case code and PIN you can{" "}
          <Link href="/status" className="text-accent underline">
            check your report
          </Link>
          .
        </p>
      </Card>
    );
  }

  const text = `Case code: ${result.caseCode}\nPIN: ${result.pin}\n\nCheck your report at: ${window.location.origin}/status\n`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked; the values are visible to copy by hand */
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${result!.caseCode}.txt` });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Thank you — your report was submitted</h1>
        <p className="text-sm text-muted">
          The review team will assess it. If it needs follow-up they&apos;ll contact you, or post questions you can read
          with your case code and PIN.
        </p>
      </div>

      <Card className="space-y-5">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <dt className="text-xs font-medium tracking-wide text-muted uppercase">Case code</dt>
            <dd className="font-mono text-xl font-semibold tracking-wider">{result.caseCode}</dd>
          </div>
          <div className="space-y-1">
            <dt className="text-xs font-medium tracking-wide text-muted uppercase">PIN</dt>
            <dd className="font-mono text-xl font-semibold tracking-wider">{result.pin}</dd>
          </div>
        </dl>
        <Alert tone="warn">
          Save these now. This is the only time the PIN is shown, and it can&apos;t be recovered. Store it somewhere
          private, not on a shared or work device.
        </Alert>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={copy}>
            {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button variant="secondary" onClick={download}>
            <Download className="size-4" aria-hidden /> Download as text
          </Button>
        </div>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/"
          onClick={() => saveResult(null)}
          className="inline-flex items-center rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink hover:opacity-90"
        >
          I&apos;ve saved them — finish
        </Link>
      </div>
    </div>
  );
}
