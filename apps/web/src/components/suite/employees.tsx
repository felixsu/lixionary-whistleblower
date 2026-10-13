"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Employee, EmployeeRequest, EmployeeInput } from "@whistle/shared";
import { useDraftState, useStaff } from "./staff-workspace";
import { Field, Select, Check, ErrorBox, useAction, friendly } from "./common";
export function Employees() {
  const {
      language: { lang, t },
      clearDrafts,
    } = useStaff(),
    a = useAction(lang),
    id = lang === "id",
    text = (en: string, indo: string) => (id ? indo : en);
  const [tab, setTab] = useState<"employees" | "requests">("employees"),
    [filter, setFilter] = useState("pending"),
    [search, setSearch] = useState(""),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [items, setItems] = useState<(Employee | EmployeeRequest)[]>([]),
    [total, setTotal] = useState(0),
    [notice, setNotice] = useState("");
  const [editing, setEditing] = useDraftState<{
      id: string;
      kind: "employee" | "request";
    } | null>("admin.employees.editing", null),
    [name, setName] = useDraftState("admin.employees.name", ""),
    [email, setEmail] = useDraftState("admin.employees.email", ""),
    [phone, setPhone] = useDraftState("admin.employees.phone", ""),
    [active, setActive] = useDraftState("admin.employees.active", true);
  const load = useCallback(async () => {
    const r = await api<{
      items: (Employee | EmployeeRequest)[];
      total: number;
    }>(
      tab === "employees"
        ? `/api/admin/employees?page=${page}&q=${encodeURIComponent(q)}`
        : `/api/admin/employee-requests?page=${page}&state=${filter}`,
    );
    setItems(r.items);
    setTotal(r.total);
  }, [tab, page, q, filter]);
  useEffect(() => {
    let valid = true;
    a.setError("");
    void load().catch((e) => {
      if (valid) a.setError(friendly(e, lang));
    });
    return () => {
      valid = false;
    };
  }, [load]);
  const reset = () => {
    clearDrafts("admin.employees.");
    setEditing(null);
    setName("");
    setEmail("");
    setPhone("");
    setActive(true);
  };
  const edit = (
    person: Employee | EmployeeRequest,
    kind: "employee" | "request",
  ) => {
    setEditing({ id: person.id, kind });
    setName(person.name);
    setEmail(person.email);
    setPhone(person.phone);
    setActive("active" in person ? person.active : true);
    document
      .getElementById("employee-form")
      ?.scrollIntoView({ block: "start" });
  };
  return (
    <>
      <h1>{t("employees")}</h1>
      <p>
        {text(
          "Employees can submit reports after email verification. Staff workspace access is managed separately.",
          "Karyawan dapat melapor setelah verifikasi email. Akses ruang kerja staf dikelola secara terpisah.",
        )}
      </p>
      <ErrorBox error={a.error} />
      {notice && <p role="status">{notice}</p>}
      <div className="employee-tabs">
        <button
          className="secondary"
          aria-pressed={tab === "employees"}
          onClick={() => {
            setTab("employees");
            setPage(1);
          }}
        >
          {t("employees")}
        </button>
        <button
          className="secondary"
          aria-pressed={tab === "requests"}
          onClick={() => {
            setTab("requests");
            setPage(1);
          }}
        >
          {text("Account requests", "Permintaan akun")}
        </button>
      </div>
      <section id="employee-form">
        <h2>
          {editing?.kind === "request"
            ? text(
                "Review and approve request",
                "Tinjau dan setujui permintaan",
              )
            : editing
              ? text("Edit employee", "Ubah karyawan")
              : text("Add employee", "Tambah karyawan")}
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void a.run(async () => {
              const employee: EmployeeInput = { name, email, phone };
              if (editing?.kind === "request")
                await api(
                  `/api/admin/employee-requests/${editing.id}/resolve`,
                  { method: "POST", body: { decision: "approved", employee } },
                );
              else
                await api(
                  editing
                    ? `/api/admin/employees/${editing.id}`
                    : "/api/admin/employees",
                  {
                    method: editing ? "PUT" : "POST",
                    body: { ...employee, active },
                  },
                );
              reset();
              setNotice(text("Saved successfully.", "Berhasil disimpan."));
              await load();
            });
          }}
        >
          <div className="grid">
            <Field
              label={t("name")}
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Field
              label="Email"
              type="email"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Field
              label={text("Phone number", "Nomor telepon")}
              type="tel"
              required
              pattern="\+[1-9][0-9]{7,14}"
              placeholder="+628123456789"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <p>
            {text(
              "Use an international phone number, e.g. +628123456789.",
              "Gunakan nomor telepon internasional, misalnya +628123456789.",
            )}
          </p>
          {editing?.kind === "employee" && (
            <Check
              label={t("active")}
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
          )}
          <button disabled={a.busy}>
            {editing?.kind === "request"
              ? text("Approve request", "Setujui permintaan")
              : t("save")}
          </button>
          <button type="button" className="secondary" onClick={reset}>
            {t("discardDraft")}
          </button>
        </form>
      </section>
      <section>
        <h2>
          {tab === "employees"
            ? text("Employee directory", "Daftar karyawan")
            : text("Account requests", "Permintaan akun")}
        </h2>
        {tab === "employees" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setQ(search);
              setPage(1);
            }}
          >
            <Field
              label={text("Search employees", "Cari karyawan")}
              maxLength={100}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button disabled={a.busy}>{text("Search", "Cari")}</button>
          </form>
        ) : (
          <Select
            label={t("state")}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="pending">{text("Pending", "Menunggu")}</option>
            <option value="approved">{text("Approved", "Disetujui")}</option>
            <option value="rejected">{text("Rejected", "Ditolak")}</option>
          </Select>
        )}
        <button
          className="secondary"
          disabled={a.busy}
          onClick={() => void a.run(load)}
        >
          {t("refresh")}
        </button>
        {!items.length && <p>{text("No records found.", "Tidak ada data.")}</p>}
        {items.map((person) => (
          <article key={person.id}>
            <h3>{person.name}</h3>
            <p>{person.email}</p>
            <p>{person.phone}</p>
            <p>
              {"active" in person
                ? person.active
                  ? text("Active", "Aktif")
                  : text("Disabled", "Nonaktif")
                : person.state === "pending"
                  ? text("Pending", "Menunggu")
                  : person.state === "approved"
                    ? text("Approved", "Disetujui")
                    : text("Rejected", "Ditolak")}
            </p>
            {"active" in person ? (
              <button
                disabled={a.busy}
                onClick={() => edit(person, "employee")}
              >
                {text("Edit", "Ubah")}
              </button>
            ) : (
              person.state === "pending" && (
                <>
                  <button
                    disabled={a.busy}
                    onClick={() => edit(person, "request")}
                  >
                    {text("Review request", "Tinjau permintaan")}
                  </button>
                  <button
                    className="secondary"
                    disabled={a.busy}
                    onClick={() =>
                      void a.run(async () => {
                        await api(
                          `/api/admin/employee-requests/${person.id}/resolve`,
                          { method: "POST", body: { decision: "rejected" } },
                        );
                        if (editing?.id === person.id) reset();
                        setNotice(
                          text("Request rejected.", "Permintaan ditolak."),
                        );
                        await load();
                      })
                    }
                  >
                    {text("Reject", "Tolak")}
                  </button>
                </>
              )
            )}
          </article>
        ))}
        <p>
          {text(
            `Page ${page} · ${total} records`,
            `Halaman ${page} · ${total} data`,
          )}
        </p>
        <div className="employee-tabs">
          <button
            className="secondary"
            disabled={page === 1 || a.busy}
            onClick={() => setPage(page - 1)}
          >
            {t("previousPage")}
          </button>
          <button
            className="secondary"
            disabled={page * 25 >= total || a.busy}
            onClick={() => setPage(page + 1)}
          >
            {t("nextPage")}
          </button>
        </div>
      </section>
    </>
  );
}
