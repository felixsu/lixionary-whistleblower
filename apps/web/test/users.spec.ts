import { test, expect, type Page } from "@playwright/test";
import type { StaffRole } from "@whistle/shared";
import { safeStaffReturn } from "../src/components/suite/staff-navigation";

const userId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const adminId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const list = "/staff/admin/users";
const edit = `${list}/${userId}/edit`;
async function fixture(page: Page, mobile: boolean, role: StaffRole = "admin") {
  await page.addInitScript(
    (lang) => localStorage.setItem("wb_language", lang),
    mobile ? "id" : "en",
  );
  const state = {
    users: [
      {
        id: userId,
        name: "Existing user",
        email: "existing@example.test",
        role: "manager",
        active: true,
        mfa_enrolled: true,
      },
    ],
    unavailable: 0,
    resetFailure: false,
    rejectCreate: false,
    expired: false,
    requests: [] as { path: string; method: string; body: any }[],
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname,
      method = route.request().method();
    const body = route.request().postData()
      ? route.request().postDataJSON()
      : undefined;
    state.requests.push({ path, method, body });
    if (path === "/api/staff/me")
      return route.fulfill({
        status: state.expired ? 401 : 200,
        json: state.expired
          ? { error: "unauthorized" }
          : {
              id: adminId,
              name: "Administrator",
              email: "admin@example.test",
              role,
              mfaEnrolled: true,
              mfaVerified: true,
            },
      });
    if (path === "/api/staff/login")
      return route.fulfill({ json: { mfaEnrolled: true } });
    if (path === "/api/staff/mfa/confirm")
      return route.fulfill({ json: { recoveryCodes: [] } });
    if (path === "/api/admin/staff" && method === "GET")
      return route.fulfill({ json: { staff: state.users } });
    if (path === "/api/admin/staff" && method === "POST") {
      if (state.rejectCreate)
        return route.fulfill({ status: 409, json: { error: "staff_exists" } });
      state.users.push({
        ...body,
        id: adminId,
        active: false,
        mfa_enrolled: false,
      });
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith("/password-reset"))
      return route.fulfill({
        status: state.resetFailure ? 503 : 200,
        json: state.resetFailure ? { error: "error" } : { ok: true },
      });
    if (path.startsWith("/api/admin/staff/")) {
      if (state.unavailable)
        return route.fulfill({
          status: state.unavailable,
          json: { error: state.unavailable === 404 ? "not_found" : "error" },
        });
      const user = state.users.find((u) => path.endsWith(u.id));
      if (!user)
        return route.fulfill({ status: 404, json: { error: "not_found" } });
      if (method === "PATCH") Object.assign(user, body);
      return route.fulfill({
        json: method === "GET" ? { staff: user } : { ok: true },
      });
    }
    return route.fulfill({ json: {} });
  });
  return state;
}

test("user list, create, edit, reset, breadcrumbs, and separate sidebar groups", async ({
  page,
}, info) => {
  const mobile = info.project.name === "mobile-id",
    label = (en: string, id: string) => (mobile ? id : en);
  const state = await fixture(page, mobile);
  await page.goto("/staff/admin/staff");
  await expect(page).toHaveURL(list);
  const main = page.getByRole("main");
  await expect(main.getByRole("table")).toBeVisible();
  await expect(main.locator("input,select")).toHaveCount(0);
  if (mobile)
    await page.getByRole("button", { name: "Menu", exact: true }).click();
  const nav = mobile ? page.getByRole("dialog") : page.locator("aside");
  await expect(
    nav.getByRole("group", {
      name: label("Workspace", "Ruang kerja"),
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    nav.getByRole("group", {
      name: label("Administration", "Administrasi"),
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    nav
      .getByRole("group", {
        name: label("Administration", "Administrasi"),
        exact: true,
      })
      .getByRole("link", { name: label("Users", "Pengguna"), exact: true }),
  ).toHaveAttribute("aria-current", "page");
  if (mobile) await page.getByRole("button", { name: "Tutup menu" }).click();
  await main
    .getByRole("link", {
      name: label("Create user", "Buat pengguna"),
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(`${list}/new`);
  const crumbs = page.getByRole("navigation", {
    name: label("Breadcrumbs", "Jejak navigasi"),
  });
  await expect(
    crumbs.getByRole("link", { name: label("Users", "Pengguna"), exact: true }),
  ).toHaveAttribute("href", list);
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText(
    label("Create user", "Buat pengguna"),
  );
  await page
    .getByLabel(label("Name", "Nama"), { exact: true })
    .fill("New user");
  await page.getByLabel("Email", { exact: true }).fill("new@example.test");
  await page
    .getByRole("combobox", { name: label("Role", "Peran"), exact: true })
    .selectOption("analyst");
  await main
    .getByRole("button", {
      name: label("Create user", "Buat pengguna"),
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(`${list}?notice=invited`);
  await expect(main.getByRole("status")).toContainText(
    label("invitation email was queued", "Email undangan telah masuk antrean"),
  );
  await main
    .getByRole("link", {
      name: label("Edit user Existing user", "Edit pengguna Existing user"),
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(edit);
  await expect(
    page.getByLabel(label("Name", "Nama"), { exact: true }),
  ).toHaveValue("Existing user");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    "existing@example.test",
  );
  await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  await expect(
    page.getByRole("combobox", { name: label("Role", "Peran"), exact: true }),
  ).toHaveValue("manager");
  await expect(
    page.getByLabel(label("Active", "Aktif"), { exact: true }),
  ).toBeChecked();
  await main
    .getByRole("button", {
      name: label(
        "Send password reset email",
        "Kirim email pengaturan ulang kata sandi",
      ),
      exact: true,
    })
    .click();
  await expect(main.getByRole("status")).toHaveText(
    label(
      "Password reset email queued.",
      "Email pengaturan ulang kata sandi masuk antrean.",
    ),
  );
  expect(state.requests.filter((r) => r.method === "PATCH")).toHaveLength(0);
  await page
    .getByLabel(label("Name", "Nama"), { exact: true })
    .fill("Updated user");
  await page
    .getByRole("combobox", { name: label("Role", "Peran"), exact: true })
    .selectOption("analyst");
  await page.getByLabel(label("Active", "Aktif"), { exact: true }).uncheck();
  await main
    .getByRole("button", {
      name: label("Save changes", "Simpan perubahan"),
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(`${list}?notice=saved`);
  expect(state.requests.find((r) => r.method === "PATCH")?.body).toEqual({
    name: "Updated user",
    role: "analyst",
    active: false,
  });
  await main
    .getByRole("link", {
      name: label("Edit user Updated user", "Edit pengguna Updated user"),
      exact: true,
    })
    .click();
  await expect(
    main.getByRole("button", {
      name: label(
        "Send password reset email",
        "Kirim email pengaturan ulang kata sandi",
      ),
      exact: true,
    }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("user form drafts stay separate, cancel clears them, and duplicate errors preserve inputs", async ({
  page,
}, info) => {
  const mobile = info.project.name === "mobile-id",
    label = (en: string, id: string) => (mobile ? id : en);
  const state = await fixture(page, mobile);
  await page.goto(`${list}/new`);
  await page
    .getByLabel(label("Name", "Nama"), { exact: true })
    .fill("Creation draft");
  await page
    .getByLabel("Email", { exact: true })
    .fill("duplicate@example.test");
  const crumbs = page.getByRole("navigation", {
    name: label("Breadcrumbs", "Jejak navigasi"),
  });
  await crumbs
    .getByRole("link", { name: label("Users", "Pengguna"), exact: true })
    .click();
  await page
    .getByRole("main")
    .getByRole("link", {
      name: label("Edit user Existing user", "Edit pengguna Existing user"),
      exact: true,
    })
    .click();
  await page
    .getByLabel(label("Name", "Nama"), { exact: true })
    .fill("Edit draft");
  await crumbs
    .getByRole("link", { name: label("Users", "Pengguna"), exact: true })
    .click();
  await page
    .getByRole("main")
    .getByRole("link", {
      name: label("Create user", "Buat pengguna"),
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel(label("Name", "Nama"), { exact: true }),
  ).toHaveValue("Creation draft");
  state.rejectCreate = true;
  await page
    .getByRole("button", {
      name: label("Create user", "Buat pengguna"),
      exact: true,
    })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    label("already exists", "sudah ada"),
  );
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    "duplicate@example.test",
  );
  await page
    .getByRole("button", { name: label("Cancel", "Batal"), exact: true })
    .click();
  await page
    .getByRole("main")
    .getByRole("link", {
      name: label("Create user", "Buat pengguna"),
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel(label("Name", "Nama"), { exact: true }),
  ).toHaveValue("");
  await crumbs
    .getByRole("link", { name: label("Users", "Pengguna"), exact: true })
    .click();
  await page
    .getByRole("main")
    .getByRole("link", {
      name: label("Edit user Existing user", "Edit pengguna Existing user"),
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel(label("Name", "Nama"), { exact: true }),
  ).toHaveValue("Edit draft");
  await page
    .getByRole("button", { name: label("Cancel", "Batal"), exact: true })
    .click();
  await page
    .getByRole("main")
    .getByRole("link", {
      name: label("Edit user Existing user", "Edit pengguna Existing user"),
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel(label("Name", "Nama"), { exact: true }),
  ).toHaveValue("Existing user");
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain("Creation draft");
});

test("user loading failures never offer placeholder edits and password reset failures keep the form", async ({
  page,
}, info) => {
  const mobile = info.project.name === "mobile-id",
    label = (en: string, id: string) => (mobile ? id : en);
  const state = await fixture(page, mobile);
  state.unavailable = 503;
  await page.goto(edit);
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(
    page.getByLabel(label("Name", "Nama"), { exact: true }),
  ).toHaveCount(0);
  state.unavailable = 0;
  await page
    .getByRole("main")
    .getByRole("button", { name: label("Refresh", "Muat ulang"), exact: true })
    .click();
  await page
    .getByLabel(label("Name", "Nama"), { exact: true })
    .fill("Preserved edit");
  state.resetFailure = true;
  await page
    .getByRole("button", {
      name: label(
        "Send password reset email",
        "Kirim email pengaturan ulang kata sandi",
      ),
      exact: true,
    })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(
    page.getByLabel(label("Name", "Nama"), { exact: true }),
  ).toHaveValue("Preserved edit");
  await page
    .getByRole("button", { name: label("Cancel", "Batal"), exact: true })
    .click();
  state.unavailable = 404;
  await page
    .getByRole("main")
    .getByRole("link", {
      name: label("Edit user Existing user", "Edit pengguna Existing user"),
      exact: true,
    })
    .click();
  await expect(page.getByRole("main")).toContainText(
    label("This user no longer exists", "Pengguna ini sudah tidak tersedia"),
  );
  await expect(
    page.getByLabel(label("Name", "Nama"), { exact: true }),
  ).toHaveCount(0);
});

for (const role of ["manager", "analyst"] as const)
  test(`${role} cannot access user pages or administration menus`, async ({
    page,
  }, info) => {
    const mobile = info.project.name === "mobile-id",
      state = await fixture(page, mobile, role);
    for (const path of [list, `${list}/new`, edit]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", {
          name: mobile
            ? "Anda tidak memiliki akses ke halaman ini"
            : "You do not have access to this page",
        }),
      ).toBeVisible();
      expect(
        state.requests.some((r) => r.path.startsWith("/api/admin/staff")),
      ).toBe(false);
    }
    if (mobile)
      await page.getByRole("button", { name: "Menu", exact: true }).click();
    const nav = mobile ? page.getByRole("dialog") : page.locator("aside");
    await expect(
      nav.getByRole("group", {
        name: mobile ? "Administrasi" : "Administration",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      nav.getByRole("group", {
        name: mobile ? "Ruang kerja" : "Workspace",
        exact: true,
      }),
    ).toBeVisible();
  });

test("new user routes survive session-expiry returns without storing drafts", async ({
  page,
}, info) => {
  const mobile = info.project.name === "mobile-id",
    state = await fixture(page, mobile);
  await page.goto(edit);
  await page
    .getByLabel(mobile ? "Nama" : "Name", { exact: true })
    .fill("Unsaved private edit");
  state.expired = true;
  await page.evaluate(() =>
    window.dispatchEvent(new Event("wb:staff-expired")),
  );
  await expect(page).toHaveURL(`/staff/login?next=${encodeURIComponent(edit)}`);
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain("Unsaved private edit");
  for (const path of [list, `${list}/new`, edit, "/staff/admin/staff"])
    expect(safeStaffReturn(path)).toBe(path);
  for (const path of [
    "https://external.test/staff/admin/users",
    "//external.test/staff/admin/users",
    `${list}/invalid/edit`,
    `${list}/../unknown`,
    `${list}/new\\evil`,
  ])
    expect(safeStaffReturn(path)).toBe("/staff");
});

test("sign-in and MFA return administrators to every user route", async ({
  page,
}, info) => {
  const mobile = info.project.name === "mobile-id";
  await fixture(page, mobile);
  for (const destination of [list, `${list}/new`, edit]) {
    await page.goto(`/staff/login?next=${encodeURIComponent(destination)}`);
    await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
    await page
      .getByLabel(mobile ? "Kata sandi" : "Password", { exact: true })
      .fill("Synthetic login password");
    await page
      .getByRole("button", { name: mobile ? "Masuk" : "Sign in", exact: true })
      .click();
    await page
      .getByLabel(
        mobile
          ? "Kode autentikator atau pemulihan"
          : "Authenticator or recovery code",
        { exact: true },
      )
      .fill("123456");
    await page
      .getByRole("button", {
        name: mobile ? "Verifikasi" : "Verify",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(destination);
  }
});
