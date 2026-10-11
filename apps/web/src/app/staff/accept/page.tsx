"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  Shell,
  useLanguage,
  useAction,
  Field,
  ErrorBox,
} from "@/components/suite/common";
export default function Accept() {
  const l = useLanguage(),
    a = useAction(l.lang),
    [token, setToken] = useState(""),
    [password, setPassword] = useState("");
  useEffect(() => {
    setToken(new URLSearchParams(location.hash.slice(1)).get("token") ?? "");
    history.replaceState(null, "", location.pathname);
  }, []);
  return (
    <Shell language={l}>
      <section>
        <h1>{l.t("newPassword")}</h1>
        <ErrorBox error={a.error} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void a.run(async () => {
              await api("/api/staff/password/accept", {
                method: "POST",
                body: { token, password },
              });
              setToken("");
              setPassword("");
              location.href = "/staff/login";
            });
          }}
        >
          <Field
            label={l.t("newPassword")}
            type="password"
            required
            minLength={15}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button disabled={!token || a.busy}>{l.t("save")}</button>
        </form>
      </section>
    </Shell>
  );
}
