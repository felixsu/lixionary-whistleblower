"use client";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  staffRoles,
  type StaffIdentity,
  type StaffRole,
} from "@whistle/shared";
import { api, ApiError } from "@/lib/api";
import { Check, ErrorBox, Field, Select, useAction } from "./common";
import { useDraftState, useStaff, DiscardDraft } from "./staff-workspace";

type User = Pick<StaffIdentity, "id" | "name" | "email" | "role"> & {
  active: boolean;
  mfa_enrolled: boolean;
  created_at: string;
};
const listPath = "/staff/admin/users";

function UserBreadcrumbs({ current }: { current?: string }) {
  const {
    language: { t },
  } = useStaff();
  return (
    <nav className="user-breadcrumbs" aria-label={t("breadcrumbs")}>
      <ol>
        <li>
          <Link href="/staff">{t("workspace")}</Link>
        </li>
        <li>
          {current ? (
            <Link href={listPath}>{t("users")}</Link>
          ) : (
            <span aria-current="page">{t("users")}</span>
          )}
        </li>
        {current && (
          <li>
            <span aria-current="page">{current}</span>
          </li>
        )}
      </ol>
    </nav>
  );
}

export function UserList() {
  const {
    language: { t, lang },
  } = useStaff();
  const a = useAction(lang),
    params = useSearchParams();
  const [users, setUsers] = useState<User[]>();
  const load = useCallback(async () => {
    setUsers((await api<{ staff: User[] }>("/api/admin/staff")).staff);
  }, []);
  useEffect(() => {
    void a.run(load);
  }, [load]);
  return (
    <>
      <UserBreadcrumbs />
      <div className="user-page-heading">
        <h1>{t("users")}</h1>
        <Link className="button" href={`${listPath}/new`}>
          {t("createUser")}
        </Link>
      </div>
      <p>{t("usersIntro")}</p>
      <ErrorBox error={a.error} />
      {params.get("notice") === "invited" && (
        <p role="status">{t("userInvited")}</p>
      )}
      {params.get("notice") === "saved" && (
        <p role="status">{t("savedChanges")}</p>
      )}
      <section>
        <button
          className="secondary"
          disabled={a.busy}
          onClick={() => void a.run(load)}
        >
          {t("refresh")}
        </button>
        {!users ? (
          <p>{t("loading")}</p>
        ) : users.length === 0 ? (
          <p>{t("noUsers")}</p>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>{t("name")}</th>
                  <th>{t("role")}</th>
                  <th>{t("active")}</th>
                  <th>{t("userActions")}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      {user.name}
                      <br />
                      <small>{user.email}</small>
                    </td>
                    <td>{t(user.role)}</td>
                    <td>{t(user.active ? "yes" : "no")}</td>
                    <td>
                      <Link
                        href={`${listPath}/${user.id}/edit`}
                        aria-label={`${t("editUser")} ${user.name}`}
                      >
                        {t("edit")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export function EditUser() {
  const { id } = useParams<{ id: string }>();
  const {
    language: { t, lang },
  } = useStaff();
  const a = useAction(lang);
  const [loaded, setLoaded] = useState<{ id: string; user: User }>();
  const [unavailable, setUnavailable] = useState(false);
  const request = useRef(0);
  const load = useCallback(async () => {
    const generation = ++request.current;
    setUnavailable(false);
    try {
      const { staff } = await api<{ staff: User }>(`/api/admin/staff/${id}`);
      if (generation === request.current) setLoaded({ id, user: staff });
    } catch (e) {
      if (generation !== request.current) return;
      if (e instanceof ApiError && e.status === 404) setUnavailable(true);
      throw e;
    }
  }, [id]);
  useEffect(() => {
    setLoaded(undefined);
    void a.run(load);
  }, [load]);
  if (loaded?.id === id) return <UserForm key={id} user={loaded.user} />;
  return (
    <>
      <UserBreadcrumbs current={t("editUser")} />
      <h1>{t("editUser")}</h1>
      <ErrorBox error={a.error} />
      <p>
        {t(
          unavailable
            ? "userUnavailable"
            : a.error
              ? "retryConnection"
              : "loading",
        )}
      </p>
      {!unavailable && (
        <button disabled={a.busy} onClick={() => void a.run(load)}>
          {t("refresh")}
        </button>
      )}
      <Link href={listPath}>{t("backToUsers")}</Link>
    </>
  );
}

export function UserForm({ user }: { user?: User }) {
  const {
    language: { t, lang },
    clearDrafts,
  } = useStaff();
  const a = useAction(lang),
    reset = useAction(lang),
    router = useRouter();
  const prefix = `admin.users.${user?.id ?? "new"}.`;
  const [form, setForm] = useDraftState<{
    email: string;
    name: string;
    role: StaffRole;
    active: boolean;
  }>(prefix + "values", {
    email: user?.email ?? "",
    name: user?.name ?? "",
    role: user?.role ?? "analyst",
    active: user?.active ?? false,
  });
  const [resetQueued, setResetQueued] = useState(false);
  const busy = a.busy || reset.busy;
  const title = t(user ? "editUser" : "createUser");
  const cancel = () => {
    clearDrafts(prefix);
    router.push(listPath);
  };
  return (
    <>
      <UserBreadcrumbs current={title} />
      <h1>{title}</h1>
      <ErrorBox error={a.error} />
      <section>
        {!user && <p>{t("userInvitationIntro")}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void a.run(async () => {
              await api(
                user ? `/api/admin/staff/${user.id}` : "/api/admin/staff",
                {
                  method: user ? "PATCH" : "POST",
                  body: user
                    ? { name: form.name, role: form.role, active: form.active }
                    : { email: form.email, name: form.name, role: form.role },
                },
              );
              clearDrafts(prefix);
              router.push(`${listPath}?notice=${user ? "saved" : "invited"}`);
            });
          }}
        >
          <Field
            label={t("name")}
            required
            maxLength={100}
            value={form.name}
            disabled={busy}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Field
            label={t("email")}
            type="email"
            required
            maxLength={254}
            readOnly={!!user}
            value={user?.email ?? form.email}
            disabled={busy}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          {user && <p className="muted">{t("userEmailReadOnly")}</p>}
          <Select
            label={t("role")}
            value={form.role}
            disabled={busy}
            onChange={(e) =>
              setForm({ ...form, role: e.target.value as StaffRole })
            }
          >
            {staffRoles.map((role) => (
              <option key={role} value={role}>
                {t(role)}
              </option>
            ))}
          </Select>
          {user && (
            <Check
              label={t("active")}
              checked={form.active}
              disabled={busy}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
          )}
          <div className="user-form-actions">
            <button disabled={busy}>
              {t(user ? "saveChanges" : "createUser")}
            </button>
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={cancel}
            >
              {t("cancel")}
            </button>
            <DiscardDraft prefix={prefix} />
          </div>
        </form>
      </section>
      {user && (
        <section>
          <h2>{t("passwordResetHeading")}</h2>
          <p>{t("userResetIntro")}</p>
          {!user.active && <p>{t("userResetInactive")}</p>}
          <ErrorBox error={reset.error} />
          {resetQueued && <p role="status">{t("userResetQueued")}</p>}
          <button
            className="secondary"
            disabled={!user.active || busy}
            onClick={() =>
              void reset.run(async () => {
                setResetQueued(false);
                await api(`/api/admin/staff/${user.id}/password-reset`, {
                  method: "POST",
                  body: {},
                });
                setResetQueued(true);
              })
            }
          >
            {t("sendPasswordReset")}
          </button>
        </section>
      )}
    </>
  );
}
