"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import type { AdminMe } from "@whistle/shared";
import { api, errorMessage } from "@/lib/api";
import { Alert, Button, Card, Field, Input } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api<AdminMe>("/api/admin/login", { method: "POST", body: { email, password } });
      const next = params.get("next");
      // Only follow same-app admin paths to avoid open redirects.
      router.replace(next && /^\/admin(\/|$)/.test(next) ? next : "/admin");
    } catch (err) {
      setError(errorMessage(err));
      setLoading(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <Field label="Email" htmlFor="l-email">
        <Input id="l-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <Field label="Password" htmlFor="l-password">
        <Input
          id="l-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </Field>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" className="w-full" loading={loading}>
        Sign in
      </Button>
    </form>
  );
}

export default function AdminLoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="size-5 text-accent" aria-hidden /> Speak Up · Review console
        </div>
        <Card>
          <Suspense>
            <LoginForm />
          </Suspense>
        </Card>
      </div>
    </main>
  );
}
