"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type {
  CompanySettings,
  StaffIdentity,
  StaffRole,
} from "@whistle/shared";
import { defaultSettings, staffRoles } from "@whistle/shared";
import {
  Check,
  ErrorBox,
  Field,
  Select,
  Text,
  useAction,
  type Lang,
} from "./common";
type Staff = StaffIdentity & { active: boolean; mfa_enrolled: boolean };
type Team = {
  id: string;
  name: string;
  restricted: boolean;
  members: { id: string; name: string; role: string }[];
};
export function Admin({ t, lang }: { t: (s: string) => string; lang: Lang }) {
  const a = useAction(lang),
    [settings, setSettings] = useState<CompanySettings>(defaultSettings),
    [staff, setStaff] = useState<Staff[]>([]),
    [teams, setTeams] = useState<Team[]>([]),
    [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [role, setRole] = useState<StaffRole>("analyst"),
    [teamName, setTeamName] = useState(""),
    [restricted, setRestricted] = useState(false),
    [auditUntil, setAuditUntil] = useState(0),
    [history, setHistory] = useState<
      { version: number; actor_id: string; created_at: string }[]
    >([]),
    [audit, setAudit] = useState<Record<string, unknown>[]>([]),
    [ops, setOps] = useState<{
      privacy: {
        unavailable?: boolean;
        providers?: { email: boolean; phone: boolean; ai: boolean };
        jobs?: { kind: string; pending: number; attempts: number }[];
        files?: { status: string; count: number }[];
      };
      jobs: { kind: string; pending: number; attempts: number }[];
      deletions: { pending: number }[];
    }>();
  const load = useCallback(async () => {
    const [s, p, q] = await Promise.all([
      api<{ body: CompanySettings }>("/api/admin/settings"),
      api<{ staff: Staff[] }>("/api/admin/staff"),
      api<{ teams: Team[] }>("/api/admin/teams"),
    ]);
    setSettings(s.body);
    setStaff(p.staff);
    setTeams(q.teams);
  }, []);
  useEffect(() => {
    void a.run(load);
  }, [load]);
  type AuditPage = { events: Record<string, unknown>[]; until: number };
  async function auditPage(after = 0, until?: number) {
    const r = await api<AuditPage>(
      `/api/admin/audit?after=${after}${until === undefined ? "" : `&until=${until}`}`,
    );
    setAuditUntil(r.until);
    setAudit(r.events);
    return r;
  }
  async function exportAudit() {
    let r = await api<AuditPage>("/api/admin/audit"),
      events = [...r.events];
    const until = r.until;
    while (r.events.length === 1000 && Number(r.events.at(-1)!.seq) < until) {
      r = await api<AuditPage>(
        `/api/admin/audit?after=${r.events.at(-1)!.seq}&until=${until}`,
      );
      events.push(...r.events);
    }
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ until, events }, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "whistleblower-audit.json";
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <ErrorBox error={a.error} />
      <section>
        <h2>{t("invite")}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void a.run(async () => {
              await api("/api/admin/staff", {
                method: "POST",
                body: { email, name, role },
              });
              setEmail("");
              setName("");
              await load();
            });
          }}
        >
          <div className="grid">
            <Field
              label={t("email")}
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Field
              label={t("name")}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Select
              label={t("role")}
              value={role}
              onChange={(e) => setRole(e.target.value as StaffRole)}
            >
              {staffRoles.map((r) => (
                <option key={r} value={r}>
                  {t(r)}
                </option>
              ))}
            </Select>
          </div>
          <button disabled={a.busy}>{t("invite")}</button>
        </form>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>{t("name")}</th>
                <th>{t("role")}</th>
                <th>{t("active")}</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.name}
                    <br />
                    <small>{s.email}</small>
                  </td>
                  <td>
                    <select
                      aria-label={`${t("role")} ${s.name}`}
                      value={s.role}
                      disabled={a.busy}
                      onChange={(e) =>
                        void a.run(async () => {
                          await api(`/api/admin/staff/${s.id}`, {
                            method: "PATCH",
                            body: {
                              name: s.name,
                              role: e.target.value,
                              active: s.active,
                            },
                          });
                          await load();
                        })
                      }
                    >
                      {staffRoles.map((r) => (
                        <option key={r} value={r}>
                          {t(r)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <Check
                      label={s.name}
                      checked={s.active}
                      disabled={a.busy}
                      onChange={(e) =>
                        void a.run(async () => {
                          await api(`/api/admin/staff/${s.id}`, {
                            method: "PATCH",
                            body: {
                              name: s.name,
                              role: s.role,
                              active: e.target.checked,
                            },
                          });
                          await load();
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <h2>{t("teams")}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void a.run(async () => {
              await api("/api/admin/teams", {
                method: "POST",
                body: { name: teamName, restricted },
              });
              setTeamName("");
              await load();
            });
          }}
        >
          <Field
            label={t("name")}
            required
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
          />
          <Check
            label={t("restricted")}
            checked={restricted}
            onChange={(e) => setRestricted(e.target.checked)}
          />
          <button disabled={a.busy}>{t("add")}</button>
        </form>
        {teams.map((team) => (
          <article key={team.id}>
            <h3>{team.name}</h3>
            {team.restricted && (
              <span className="badge">{t("restricted")}</span>
            )}
            <p>
              {lang === "id"
                ? "Minimal dua manajer aktif diperlukan untuk peninjauan independen."
                : "At least two active managers are required for independent review."}
            </p>
            {staff
              .filter((s) => s.active && s.role !== "admin")
              .map((s) => (
                <Check
                  key={s.id}
                  label={`${s.name} · ${t(s.role)}`}
                  disabled={a.busy}
                  checked={team.members.some((m) => m.id === s.id)}
                  onChange={(e) =>
                    void a.run(async () => {
                      const staffIds = e.target.checked
                        ? [...team.members.map((m) => m.id), s.id]
                        : team.members
                            .filter((m) => m.id !== s.id)
                            .map((m) => m.id);
                      await api(`/api/admin/teams/${team.id}/members`, {
                        method: "PUT",
                        body: { staffIds },
                      });
                      await load();
                    })
                  }
                />
              ))}
          </article>
        ))}
      </section>
      <section>
        <h2>{t("settings")}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void a.run(async () => {
              await api("/api/admin/settings", {
                method: "PUT",
                body: {
                  ...settings,
                  businessUnits: settings.businessUnits
                    .map((x) => x.trim())
                    .filter(Boolean),
                },
              });
              await load();
            });
          }}
        >
          <Field
            label={t("companyName")}
            required
            value={settings.companyName}
            onChange={(e) =>
              setSettings({ ...settings, companyName: e.target.value })
            }
          />
          <div className="grid">
            {(["en", "id"] as const).map((locale) => (
              <div key={locale}>
                <h3>{locale === "en" ? "English" : "Bahasa Indonesia"}</h3>
                <Text
                  label={t("policy")}
                  minLength={20}
                  required
                  value={settings.policy[locale]}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      policy: { ...settings.policy, [locale]: e.target.value },
                    })
                  }
                />
                <Text
                  label={t("notice")}
                  minLength={20}
                  required
                  value={settings.privacyNotice[locale]}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      privacyNotice: {
                        ...settings.privacyNotice,
                        [locale]: e.target.value,
                      },
                    })
                  }
                />
                <Text
                  label={t("notificationTemplates")}
                  minLength={10}
                  maxLength={300}
                  required
                  value={settings.notificationTemplates[locale]}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      notificationTemplates: {
                        ...settings.notificationTemplates,
                        [locale]: e.target.value,
                      },
                    })
                  }
                />
              </div>
            ))}
          </div>
          <h3>{t("category")}</h3>
          {settings.categories.map((c, i) => (
            <div className="grid" key={i}>
              <Field
                label={lang === "id" ? "Kode kategori" : "Category code"}
                required
                pattern="[a-z0-9_]+"
                value={c.key}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    categories: settings.categories.map((x, j) =>
                      j === i ? { ...x, key: e.target.value } : x,
                    ),
                  })
                }
              />
              {(["en", "id"] as const).map((locale) => (
                <Field
                  key={locale}
                  label={locale === "en" ? "English" : "Bahasa Indonesia"}
                  required
                  value={c[locale]}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      categories: settings.categories.map((x, j) =>
                        j === i ? { ...x, [locale]: e.target.value } : x,
                      ),
                    })
                  }
                />
              ))}
              <button
                type="button"
                disabled={settings.categories.length < 2}
                onClick={() =>
                  setSettings({
                    ...settings,
                    categories: settings.categories.filter((_, j) => j !== i),
                  })
                }
              >
                {t("delete")}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setSettings({
                ...settings,
                categories: [
                  ...settings.categories,
                  { key: "", en: "", id: "" },
                ],
              })
            }
          >
            {t("add")}
          </button>
          <Text
            label={`${t("businessUnits")} (${lang === "id" ? "satu per baris" : "one per line"})`}
            value={settings.businessUnits.join("\n")}
            onChange={(e) =>
              setSettings({
                ...settings,
                businessUnits: e.target.value.split("\n"),
              })
            }
          />
          <div className="grid">
            {(["defaultTeamId", "restrictedTeamId"] as const).map((k) => (
              <Select
                key={k}
                label={t(k)}
                required
                value={settings[k] ?? ""}
                onChange={(e) =>
                  setSettings({ ...settings, [k]: e.target.value || null })
                }
              >
                <option value="">—</option>
                {teams
                  .filter(
                    (team) => team.restricted === (k === "restrictedTeamId"),
                  )
                  .map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
              </Select>
            ))}
            {(["acknowledgmentDays", "followupDays"] as const).map((k) => (
              <Field
                key={k}
                label={t(k)}
                type="number"
                min={1}
                max={365}
                required
                value={settings[k]}
                onChange={(e) =>
                  setSettings({ ...settings, [k]: Number(e.target.value) })
                }
              />
            ))}
          </div>
          <h3>{t("retention")}</h3>
          <div className="grid">
            {(
              [
                "cases",
                "contacts",
                "evidence",
                "transcripts",
                "audit",
                "backups",
              ] as const
            ).map((k) => (
              <Field
                key={k}
                label={t(k)}
                type="number"
                min={1}
                max={36500}
                required
                value={settings.retention?.[k] ?? ""}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    retention: {
                      ...(settings.retention ?? {
                        cases: 0,
                        contacts: 0,
                        evidence: 0,
                        transcripts: 0,
                        audit: 0,
                        backups: 0,
                      }),
                      [k]: Number(e.target.value),
                    },
                  })
                }
              />
            ))}
          </div>
          <Check
            label={t("aiEnabled")}
            checked={settings.aiEnabled}
            onChange={(e) =>
              setSettings({ ...settings, aiEnabled: e.target.checked })
            }
          />
          <button disabled={a.busy}>{t("save")}</button>
        </form>
      </section>
      <section>
        <h2>{lang === "id" ? "Riwayat kebijakan" : "Policy history"}</h2>
        <button
          onClick={() =>
            void a.run(async () =>
              setHistory(
                (
                  await api<{ history: typeof history }>(
                    "/api/admin/settings/history",
                  )
                ).history,
              ),
            )
          }
        >
          {t("refresh")}
        </button>
        {history.map((h) => (
          <p key={h.version}>
            v{h.version} · {new Date(h.created_at).toLocaleString(lang)} ·{" "}
            {h.actor_id}
          </p>
        ))}
      </section>
      <section>
        <h2>{t("operations")}</h2>
        <button
          onClick={() =>
            void a.run(async () => setOps(await api("/api/admin/operations")))
          }
        >
          {t("refresh")}
        </button>
        {ops && (
          <>
            <table>
              <thead>
                <tr>
                  <th>
                    {lang === "id" ? "Jenis pengiriman" : "Delivery type"}
                  </th>
                  <th>{t("pending")}</th>
                </tr>
              </thead>
              <tbody>
                {ops.jobs.map((j) => (
                  <tr key={j.kind}>
                    <td>{j.kind.replaceAll("_", " ")}</td>
                    <td>{j.pending}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>
              {lang === "id"
                ? "Layanan kontak privat"
                : "Private contact service"}
            </h3>
            <p>
              {ops.privacy.unavailable
                ? lang === "id"
                  ? "Tidak tersedia"
                  : "Unavailable"
                : lang === "id"
                  ? "Tersedia"
                  : "Available"}
            </p>
            {ops.privacy.providers && (
              <p>
                Email: {ops.privacy.providers.email ? "✓" : "—"} · SMS:{" "}
                {ops.privacy.providers.phone ? "✓" : "—"} · AI:{" "}
                {ops.privacy.providers.ai ? "✓" : "—"}
              </p>
            )}
            {ops.privacy.jobs?.map((j) => (
              <p key={j.kind}>
                {j.kind.replaceAll("_", " ")}: {j.pending} {t("pending")} ·{" "}
                {lang === "id" ? "Percobaan" : "Attempts"}: {j.attempts}
              </p>
            ))}
            {ops.privacy.files?.map((f) => (
              <p key={f.status}>
                {t(f.status)}: {f.count}
              </p>
            ))}
            <p>
              {t("delete")}: {ops.deletions[0]?.pending ?? 0} {t("pending")}
            </p>
          </>
        )}
      </section>
      <section>
        <h2>{t("audit")}</h2>
        <button
          onClick={() =>
            void a.run(async () => {
              await auditPage();
            })
          }
        >
          {t("refresh")}
        </button>
        <button
          disabled={
            a.busy || !audit.length || Number(audit.at(-1)!.seq) >= auditUntil
          }
          onClick={() =>
            void a.run(async () => {
              await auditPage(Number(audit.at(-1)!.seq), auditUntil);
            })
          }
        >
          {lang === "id" ? "Halaman berikutnya" : "Next page"}
        </button>
        <button disabled={a.busy} onClick={() => void a.run(exportAudit)}>
          {lang === "id" ? "Unduh riwayat" : "Download history"}
        </button>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>{t("state")}</th>
                <th>{t("staff")}</th>
                <th>{lang === "id" ? "Waktu" : "Time"}</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((row) => (
                <tr key={String(row.id)}>
                  <td>{String(row.action).replaceAll("_", " ")}</td>
                  <td>{String(row.actor_id)}</td>
                  <td>
                    {new Date(String(row.created_at)).toLocaleString(lang)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
