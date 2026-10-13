import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { defaultSettings, type StaffRole } from "@whistle/shared";
const caseId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const personId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const teamId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const independentId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const base = `/staff/cases/${caseId}`;
async function fixture(page: Page, role: StaffRole = "manager", id = false) {
  await page.addInitScript(
    (language) => localStorage.setItem("wb_language", language),
    id ? "id" : "en",
  );
  const state = {
    expired: false,
    mfa: true,
    missing: false,
    rejectMessage: false,
    rejectSettings: false,
    settingsUnavailable: false,
    largeAudit: false,
    requests: [] as {
      path: string;
      method: string;
      body: any;
      query: string;
    }[],
    settings: {
      ...structuredClone(defaultSettings),
      defaultTeamId: teamId,
      restrictedTeamId: independentId,
      retention: {
        cases: 365,
        contacts: 365,
        evidence: 365,
        transcripts: 365,
        audit: 365,
        backups: 365,
      },
    },
    report: {
      id: caseId,
      caseCode: "WB-ROUTED",
      state: "triage",
      category: "fraud",
      severity: "normal",
      sensitive: false,
      content: {
        title: "Synthetic case",
        summary: "Synthetic report summary",
        details: {},
      },
      messages: [] as any[],
      verification: { state: "none" },
      notes: [] as any[],
      findings: [] as any[],
      tasks: [] as any[],
      evidence: [{ id: personId, mime: "application/pdf" }],
      hold: false,
      closure: null as any,
      reopenRequests: [],
      audit: [
        {
          id: personId,
          action: "case_created",
          created_at: new Date().toISOString(),
        },
      ],
      members: [],
    },
  };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname,
      method = route.request().method(),
      body = route.request().postData() ? route.request().postDataJSON() : null;
    state.requests.push({ path, method, body, query: url.search });
    const send = (json: unknown, status = 200) =>
      route.fulfill({ json, status });
    if (path === "/api/staff/login") return send({ mfaEnrolled: true });
    if (path === "/api/staff/mfa/confirm") {
      state.expired = false;
      state.mfa = true;
      return send({ recoveryCodes: [] });
    }
    if (path === "/api/staff/logout") {
      state.expired = true;
      return send({});
    }
    if (state.expired && path !== "/api/reporter/company")
      return send({ error: "unauthorized" }, 401);
    if (path === "/api/staff/me")
      return send({
        id: personId,
        name: "Synthetic staff",
        email: "synthetic@example.test",
        role,
        mfaEnrolled: true,
        mfaVerified: state.mfa,
      });
    if (path === "/api/staff/sessions")
      return send([
        {
          id: personId,
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        },
      ]);
    if (path.startsWith("/api/staff/sessions/")) {
      state.expired = true;
      return send({});
    }
    if (path === "/api/reporter/company") return send(state.settings);
    if (path === "/api/admin/settings") {
      if (state.settingsUnavailable) return send({ error: "error" }, 503);
      if (method === "PUT") {
        if (state.rejectSettings)
          return send({ error: "configuration_incomplete" }, 400);
        state.settings = body;
      }
      return send({ body: state.settings });
    }
    if (path === "/api/admin/settings/history")
      return send({
        history: [
          {
            version: 2,
            actor_id: personId,
            created_at: new Date().toISOString(),
          },
        ],
      });
    if (path === "/api/admin/staff")
      return send({
        staff: [
          {
            id: personId,
            name: "Synthetic staff",
            email: "synthetic@example.test",
            role: "manager",
            active: true,
          },
        ],
      });
    if (path.startsWith("/api/admin/staff/")) return send({});
    if (path === "/api/admin/teams")
      return send({
        teams: [
          { id: teamId, name: "Standard", restricted: false, members: [] },
          {
            id: independentId,
            name: "Independent",
            restricted: true,
            members: [],
          },
        ],
      });
    if (path.startsWith("/api/admin/teams/")) return send({});
    if (path === "/api/admin/operations")
      return send({
        privacy: { providers: { email: true, phone: false, ai: false } },
        jobs: [{ kind: "staff_alert", pending: 2 }],
        deletions: [{ pending: 0 }],
      });
    if (path === "/api/admin/analytics")
      return send({
        groups: [],
        outcomes: [],
        correctiveActions: [],
        suppressionThreshold: 5,
      });
    if (path === "/api/admin/audit") {
      const after = Number(url.searchParams.get("after") ?? 0),
        total = state.largeAudit ? 1001 : 1;
      return send({
        until: total,
        events: Array.from(
          { length: Math.min(1000, total - after) },
          (_, i) => ({
            id: String(after + i + 1),
            seq: after + i + 1,
            action: "staff_updated",
            actor_id: personId,
            created_at: new Date().toISOString(),
          }),
        ),
      });
    }
    if (path === "/api/cases")
      return send({
        cases: [
          {
            id: caseId,
            case_code: "WB-ROUTED",
            state: state.report.state,
            category: "fraud",
            overdue: true,
            unread: true,
          },
        ],
      });
    if (path === `/api/cases/${caseId}`)
      return state.missing
        ? send({ error: "not_found" }, 404)
        : send(state.report);
    if (path === `/api/cases/${caseId}/people`)
      return send({ staff: [{ id: personId, name: "Synthetic staff" }] });
    if (path.startsWith(`/api/cases/${caseId}/`)) {
      const action = path.slice(`/api/cases/${caseId}/`.length);
      if (action === "messages") {
        if (state.rejectMessage) return send({ error: "case_closed" }, 409);
        state.report.messages.push({
          id: personId,
          author: "staff",
          body: body.body,
          createdAt: new Date().toISOString(),
        });
      } else if (action === "records") {
        const target =
          body.kind === "note"
            ? "notes"
            : body.kind === "finding"
              ? "findings"
              : "tasks";
        state.report[target].push({
          id: personId,
          body: { text: body.body },
          due_at: body.dueAt,
        });
      } else if (action.endsWith("/complete"))
        state.report.tasks[0].completed_at = new Date().toISOString();
      else if (action === "classification") Object.assign(state.report, body);
      else if (action === "state") state.report.state = body.state;
      else if (action === "hold") state.report.hold = body.hold;
      else if (action === "closure") {
        state.report.state = "closure_review";
        state.report.closure = { ...body, requestedBy: personId };
      } else if (action === "closure/review")
        state.report.state = body.approve ? "closed" : "investigating";
      else if (action === "reopen") state.report.state = "investigating";
      return send({});
    }
    return send({ error: "not_found" }, 404);
  });
  return state;
}
async function menuLink(page: Page, name: string, mobile: boolean) {
  if (mobile) {
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("link", { name, exact: true })
      .click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  } else
    await page
      .locator("aside")
      .getByRole("link", { name, exact: true })
      .click();
}
async function caseSection(page: Page, segment: string, mobile: boolean) {
  if (mobile)
    await page
      .getByRole("combobox", { name: "Bagian kasus" })
      .selectOption(base + (segment ? `/${segment}` : ""));
  else
    await page
      .locator(".case-sections")
      .locator(`a[href='${base}${segment ? `/${segment}` : ""}']`)
      .click();
  await expect(page).toHaveURL(base + (segment ? `/${segment}` : ""));
}
for (const role of ["admin", "manager", "analyst"] as const) {
  test(`${role} landing and role-aware routes`, async ({ page }, info) => {
    const mobile = info.project.name === "mobile-id";
    const state = await fixture(page, role, mobile);
    await page.goto("/staff");
    await expect(page).toHaveURL(
      role === "admin" ? "/staff/admin/settings" : "/staff/cases",
    );
    await expect(
      page.getByRole("heading", {
        name:
          role === "admin"
            ? mobile
              ? "Pengaturan perusahaan"
              : "Company settings"
            : mobile
              ? "Kasus"
              : "Cases",
        exact: true,
      }),
    ).toBeVisible();
    if (!mobile && role === "admin")
      await page.screenshot({ path: info.outputPath("desktop-settings.png") });
    const nav = mobile ? page.getByRole("dialog") : page.locator("aside");
    if (mobile) {
      const toggle = page.getByRole("button", { name: "Menu", exact: true });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.click();
      await expect(nav).toBeVisible();
      await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
      await page.keyboard.press("Shift+Tab");
      expect(
        await page.evaluate(() => !!document.activeElement?.closest("dialog")),
      ).toBe(true);
      await page.keyboard.press("Tab");
      await expect(
        nav.getByRole("button", { name: "Tutup menu" }),
      ).toBeFocused();
      if (role === "manager")
        await page.screenshot({ path: info.outputPath("mobile-drawer.png") });
      await page.keyboard.press("Escape");
      await expect(toggle).toBeFocused();
      await toggle.click();
      await page.mouse.click(page.viewportSize()!.width - 8, 100);
      await expect(nav).toBeHidden();
      await toggle.click();
    } else
      await expect(
        page.getByRole("button", { name: "Menu", exact: true }),
      ).toBeHidden();
    await expect(
      nav.getByRole("link", { name: mobile ? "Kasus" : "Cases", exact: true }),
    ).toHaveCount(role === "admin" ? 0 : 1);
    await expect(nav.locator("a[href='/staff/admin/users']")).toHaveCount(
      role === "admin" ? 1 : 0,
    );
    if (mobile) {
      await page.getByRole("button", { name: "Tutup menu" }).click();
      await expect(nav).toBeHidden();
    }
    await menuLink(page, mobile ? "Statistik" : "Statistics", mobile);
    await page
      .getByRole("button", { name: mobile ? "Muat ulang" : "Refresh" })
      .click();
    await expect(
      page.getByRole("button", {
        name: mobile ? "Unduh statistik" : "Download statistics",
      }),
    ).toBeVisible();
    await menuLink(page, mobile ? "Akun" : "Account", mobile);
    await expect(
      page.getByRole("heading", { name: "Synthetic staff" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: mobile ? "Cabut" : "Revoke" }),
    ).toBeVisible();
    await page.goto(role === "admin" ? base : "/staff/admin/users");
    await expect(
      page.getByRole("heading", {
        name: mobile
          ? "Anda tidak memiliki akses ke halaman ini"
          : "You do not have access to this page",
      }),
    ).toBeVisible();
    expect(
      state.requests.some(
        (r) =>
          r.path ===
          (role === "admin" ? `/api/cases/${caseId}` : "/api/admin/staff"),
      ),
    ).toBe(false);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
test("case routes keep drafts, filter history, mutations and unavailable states", async ({
  page,
}, info) => {
  const mobile = info.project.name === "mobile-id",
    state = await fixture(page, "manager", mobile);
  await page.clock.install();
  await page.goto("/staff/cases?state=triage&page=2");
  await expect(page.getByRole("link", { name: "WB-ROUTED" })).toBeVisible();
  expect(
    state.requests.some(
      (r) =>
        r.path === "/api/cases" &&
        r.query.includes("page=2") &&
        r.query.includes("state=triage"),
    ),
  ).toBe(true);
  await page
    .getByRole("combobox", { name: mobile ? "Status" : "Status", exact: true })
    .selectOption("closed");
  await expect(page).toHaveURL("/staff/cases?state=closed");
  await page.goBack();
  await expect(page).toHaveURL("/staff/cases?state=triage&page=2");
  await page.getByRole("link", { name: "WB-ROUTED" }).click();
  await expect(page.getByRole("heading", { name: /WB-ROUTED/ })).toBeVisible();
  await caseSection(page, "messages", mobile);
  const body = page.getByRole("textbox", {
    name: mobile ? "Pesan" : "Message",
    exact: true,
  });
  await body.fill("Unfinished private reply");
  // Polling refreshes report data without replacing an edited form.
  await page.clock.runFor(31000);
  await expect(body).toHaveValue("Unfinished private reply");
  expect(
    state.requests.filter(
      (r) => r.path === `/api/cases/${caseId}` && r.method === "GET",
    ).length,
  ).toBeGreaterThan(1);
  await caseSection(page, "evidence", mobile);
  await expect(
    page.locator(`a[href='/api/cases/${caseId}/evidence/${personId}']`),
  ).toBeVisible();
  await caseSection(page, "messages", mobile);
  await expect(body).toHaveValue("Unfinished private reply");
  state.rejectMessage = true;
  await page
    .getByRole("button", { name: mobile ? "Kirim" : "Send", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(body).toHaveValue("Unfinished private reply");
  state.rejectMessage = false;
  await page
    .getByRole("button", { name: mobile ? "Kirim" : "Send", exact: true })
    .click();
  await expect(body).toHaveValue("");
  await expect(
    page.getByText("Unfinished private reply", { exact: true }),
  ).toBeVisible();
  await body.fill("Discard this draft");
  await page
    .getByRole("button", {
      name: mobile
        ? "Buang perubahan yang belum disimpan"
        : "Discard unsaved changes",
    })
    .click();
  await expect(body).toHaveValue("");
  await caseSection(page, "investigation", mobile);
  await page
    .getByLabel(mobile ? "Catatan internal" : "Internal notes", { exact: true })
    .fill("Synthetic internal note");
  await page
    .getByRole("button", { name: mobile ? "Simpan" : "Save", exact: true })
    .click();
  await expect(
    page.getByText("Synthetic internal note", { exact: true }),
  ).toBeVisible();
  await caseSection(page, "actions", mobile);
  await page
    .getByLabel(mobile ? "Tindakan perbaikan" : "Corrective actions", {
      exact: true,
    })
    .fill("Synthetic corrective action");
  await page
    .getByRole("button", { name: mobile ? "Simpan" : "Save", exact: true })
    .click();
  await expect(
    page.getByText("Synthetic corrective action", { exact: true }),
  ).toBeVisible();
  expect(
    state.requests.find((r) => r.body?.body === "Synthetic corrective action")
      ?.body.kind,
  ).toBe("task");
  await page
    .getByLabel(
      mobile
        ? "Bukti penyelesaian tindakan"
        : "Evidence of corrective action completion",
    )
    .fill("Synthetic completion evidence");
  await page
    .getByRole("button", { name: mobile ? "Tandai selesai" : "Mark complete" })
    .click();
  await expect(
    page.getByRole("button", {
      name: mobile ? "Tandai selesai" : "Mark complete",
    }),
  ).toHaveCount(0);
  await caseSection(page, "closure", mobile);
  await page
    .getByLabel(mobile ? "Alasan internal" : "Internal rationale")
    .fill("Synthetic rationale that is sufficiently long");
  await page
    .getByLabel(
      mobile ? "Penjelasan untuk pelapor" : "Explanation for reporter",
    )
    .fill("Synthetic explanation that is sufficiently long");
  await page
    .getByRole("button", {
      name: mobile
        ? "Ajukan penutupan untuk ditinjau"
        : "Submit for closure review",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", {
      name: mobile ? "Tinjau penutupan" : "Review closure",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: mobile ? "Setujui" : "Approve",
      exact: true,
    }),
  ).toHaveCount(0);
  await caseSection(page, "history", mobile);
  await expect(page.getByText(/case created/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/case created/)).toBeVisible();
  await caseSection(page, "messages", mobile);
  await expect(body).toHaveValue("");
  state.missing = true;
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: mobile
        ? "Kasus ini tidak tersedia atau Anda tidak memiliki akses."
        : "This case is unavailable or you do not have access.",
    }),
  ).toBeVisible();
});
test("admin pages load independently, keep settings drafts and export all audit pages", async ({
  page,
}, info) => {
  const mobile = info.project.name === "mobile-id",
    state = await fixture(page, "admin", mobile);
  await page.goto("/staff/admin/settings");
  const company = page.getByLabel(mobile ? "Nama perusahaan" : "Company name");
  await company.fill("Draft company");
  expect(
    state.requests.some(
      (r) =>
        r.path === "/api/admin/staff" ||
        r.path === "/api/admin/operations" ||
        r.path === "/api/admin/analytics",
    ),
  ).toBe(false);
  await menuLink(page, mobile ? "Tim peninjau" : "Review teams", mobile);
  await expect(
    page.getByRole("heading", { name: "Standard", exact: true }),
  ).toBeVisible();
  await menuLink(
    page,
    mobile ? "Pengaturan perusahaan" : "Company settings",
    mobile,
  );
  await expect(company).toHaveValue("Draft company");
  state.rejectSettings = true;
  await page
    .getByRole("button", { name: mobile ? "Simpan" : "Save", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(company).toHaveValue("Draft company");
  await expect(
    page.locator('[data-settings-group="retention"]'),
  ).toHaveAttribute("open", "");
  state.rejectSettings = false;
  await page
    .getByRole("button", { name: mobile ? "Simpan" : "Save", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    mobile ? "Perubahan tersimpan" : "Changes saved",
  );
  await expect(
    page.getByRole("button", {
      name: mobile
        ? "Buang perubahan yang belum disimpan"
        : "Discard unsaved changes",
    }),
  ).toHaveCount(0);
  expect(state.settings.companyName).toBe("Draft company");
  expect(state.settings.retention.backups).toBe(365);
  await page
    .getByRole("link", {
      name: mobile ? "Riwayat kebijakan" : "Policy history",
      exact: true,
    })
    .click();
  await expect(page.getByText(/v2 ·/)).toBeVisible();
  await menuLink(page, mobile ? "Pengguna" : "Users", mobile);
  const create = page.getByRole("main").getByRole("link", {
    name: mobile ? "Buat pengguna" : "Create user",
    exact: true,
  });
  await create.click();
  const email = page.getByLabel("Email", { exact: true });
  await email.fill("new@example.test");
  await page
    .getByLabel(mobile ? "Nama" : "Name", { exact: true })
    .fill("New synthetic staff");
  await menuLink(page, mobile ? "Akun" : "Account", mobile);
  await menuLink(page, mobile ? "Pengguna" : "Users", mobile);
  await create.click();
  await expect(email).toHaveValue("new@example.test");
  await page
    .getByRole("button", {
      name: mobile ? "Buat pengguna" : "Create user",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/staff\/admin\/users\?notice=invited$/);
  await create.click();
  await expect(email).toHaveValue("");
  await page
    .getByRole("button", { name: mobile ? "Batal" : "Cancel", exact: true })
    .click();
  await menuLink(
    page,
    mobile ? "Pengiriman dan retensi" : "Delivery and retention",
    mobile,
  );
  await expect(
    page.getByText(
      mobile ? "Layanan kontak privat" : "Private contact service",
      { exact: true },
    ),
  ).toBeVisible();
  state.largeAudit = true;
  await menuLink(page, mobile ? "Riwayat audit" : "Audit history", mobile);
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: mobile ? "Unduh riwayat" : "Download history",
    })
    .click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(exported.events).toHaveLength(1001);
  expect(exported.until).toBe(1001);
  expect(
    state.requests.some(
      (r) => r.query.includes("after=1000") && r.query.includes("until=1001"),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("session expiry restores a safe deep link and clears private drafts", async ({
  page,
}, info) => {
  const mobile = info.project.name === "mobile-id",
    state = await fixture(page, "manager", mobile);
  await page.goto(base + "/messages");
  await page
    .getByLabel(mobile ? "Pesan" : "Message", { exact: true })
    .fill("Private unsaved text");
  state.expired = true;
  await page
    .getByRole("button", { name: mobile ? "Kirim" : "Send", exact: true })
    .click();
  await expect(page).toHaveURL(
    `/staff/login?next=${encodeURIComponent(base + "/messages")}`,
  );
  // The localized password label appears after login hydration; wait before entering email.
  await expect(
    page.getByLabel(mobile ? "Kata sandi" : "Password", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Email", { exact: true })
    .fill("synthetic@example.test");
  await page
    .getByLabel(mobile ? "Kata sandi" : "Password", { exact: true })
    .fill("Synthetic authentication password");
  await page
    .getByRole("button", { name: mobile ? "Masuk" : "Sign in", exact: true })
    .click();
  await page
    .getByLabel(
      mobile
        ? "Kode autentikator atau pemulihan"
        : "Authenticator or recovery code",
    )
    .fill("123456");
  await page
    .getByRole("button", {
      name: mobile ? "Verifikasi" : "Verify",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(base + "/messages");
  await expect(
    page.getByLabel(mobile ? "Pesan" : "Message", { exact: true }),
  ).toHaveValue("");
  expect(
    await page.evaluate(
      () => JSON.stringify(localStorage) + JSON.stringify(sessionStorage),
    ),
  ).not.toContain("Private unsaved text");
  await menuLink(page, mobile ? "Akun" : "Account", mobile);
  await page.getByRole("button", { name: mobile ? "Cabut" : "Revoke" }).click();
  await expect(page).toHaveURL(
    `/staff/login?next=${encodeURIComponent("/staff/account")}`,
  );
});
test("failed settings load never offers a placeholder save", async ({
  page,
}, info) => {
  const mobile = info.project.name === "mobile-id",
    state = await fixture(page, "admin", mobile);
  state.settingsUnavailable = true;
  await page.goto("/staff/admin/settings");
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("button", { name: mobile ? "Simpan" : "Save", exact: true }),
  ).toHaveCount(0);
  state.settingsUnavailable = false;
  await page
    .getByRole("button", {
      name: mobile ? "Muat ulang" : "Refresh",
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel(mobile ? "Nama perusahaan" : "Company name"),
  ).toHaveValue("Speak Up");
});

test("manager closure review, holds and reopening retain their permissions", async ({
  page,
}, info) => {
  const mobile = info.project.name === "mobile-id",
    state = await fixture(page, "manager", mobile);
  state.report.state = "closure_review";
  state.report.closure = {
    outcome: "substantiated",
    rationale: "Synthetic independent closure rationale",
    publicExplanation: "Synthetic reporter explanation",
    requestedBy: teamId,
  };
  await page.goto(base + "/closure");
  const review = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: mobile ? "Tinjau penutupan" : "Review closure",
      exact: true,
    }),
  });
  await review.getByRole("textbox").fill("Independent review completed");
  await review
    .getByRole("button", { name: mobile ? "Setujui" : "Approve", exact: true })
    .click();
  await expect(page.locator(".case-badges")).toContainText(
    mobile ? "Ditutup" : "Closed",
  );
  const hold = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: mobile ? "Penahanan hukum" : "Legal hold",
      exact: true,
    }),
  });
  await hold
    .getByRole("textbox")
    .first()
    .fill("Synthetic legal hold rationale");
  await hold
    .getByRole("checkbox", {
      name: mobile ? "Penahanan hukum" : "Legal hold",
      exact: true,
    })
    .click();
  await expect(
    hold.getByRole("checkbox", {
      name: mobile ? "Penahanan hukum" : "Legal hold",
      exact: true,
    }),
  ).toBeChecked();
  await expect(hold.getByRole("textbox").first()).toHaveValue("");
  await hold.getByRole("textbox").last().fill("Synthetic reopening rationale");
  await hold
    .getByRole("button", {
      name: mobile ? "Minta dibuka kembali" : "Request reopening",
      exact: true,
    })
    .click();
  await expect(page.locator(".case-badges")).toContainText(
    mobile ? "Diselidiki" : "Investigating",
  );
  expect(
    state.requests.find((r) => r.path.endsWith("/hold"))?.body.reason,
  ).toBe("Synthetic legal hold rationale");
  expect(
    state.requests.find((r) => r.path.endsWith("/reopen"))?.body.reason,
  ).toBe("Synthetic reopening rationale");
});

test("analyst case screens hide manager-only controls", async ({
  page,
}, info) => {
  const mobile = info.project.name === "mobile-id";
  await fixture(page, "analyst", mobile);
  await page.goto(base);
  await expect(page.getByRole("heading", { name: /WB-ROUTED/ })).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: mobile ? "Penyelidik utama" : "Primary investigator",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: mobile
        ? "Eskalasi ke tim independen"
        : "Escalate to independent team",
    }),
  ).toHaveCount(0);
  await caseSection(page, "closure", mobile);
  await expect(
    page.getByRole("heading", {
      name: mobile ? "Penahanan hukum" : "Legal hold",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: mobile
        ? "Ajukan penutupan untuk ditinjau"
        : "Submit for closure review",
      exact: true,
    }),
  ).toBeVisible();
});

test("unsaved refresh warns and sign-out clears drafts without a warning", async ({
  page,
}, info) => {
  const mobile = info.project.name === "mobile-id",
    state = await fixture(page, "manager", mobile);
  await page.goto(base + "/messages");
  const body = page.getByRole("textbox", {
    name: mobile ? "Pesan" : "Message",
    exact: true,
  });
  await body.fill("Draft before refresh");
  let unloads = 0;
  page.on("dialog", async (dialog) => {
    expect(dialog.type()).toBe("beforeunload");
    unloads++;
    await dialog.accept();
  });
  await page.reload();
  await expect(body).toHaveValue("");
  expect(unloads).toBe(1);
  await body.fill("Draft before logout");
  if (mobile) {
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Keluar", exact: true })
      .click();
  } else
    await page
      .locator("aside")
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
  await expect(page).toHaveURL("/staff/login");
  expect(unloads).toBe(1);
  state.expired = false;
  await page.goto(base + "/messages");
  await expect(body).toHaveValue("");
});

test("login rejects external return URLs and requires MFA for deep links", async ({
  page,
}, info) => {
  const mobile = info.project.name === "mobile-id",
    state = await fixture(page, "manager", mobile);
  state.mfa = false;
  await page.goto(base + "/evidence");
  await expect(page).toHaveURL(
    `/staff/login?next=${encodeURIComponent(base + "/evidence")}`,
  );
  expect(state.requests.some((r) => r.path === `/api/cases/${caseId}`)).toBe(
    false,
  );
  await page.goto(
    "/staff/login?next=https%3A%2F%2Fexample.com%2Fstaff%2Fcases",
  );
  // The localized password label appears after login hydration; wait before entering email.
  await expect(
    page.getByLabel(mobile ? "Kata sandi" : "Password", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Email", { exact: true })
    .fill("synthetic@example.test");
  await page
    .getByLabel(mobile ? "Kata sandi" : "Password", { exact: true })
    .fill("Synthetic authentication password");
  await page
    .getByRole("button", { name: mobile ? "Masuk" : "Sign in", exact: true })
    .click();
  await page
    .getByLabel(
      mobile
        ? "Kode autentikator atau pemulihan"
        : "Authenticator or recovery code",
    )
    .fill("123456");
  await page
    .getByRole("button", {
      name: mobile ? "Verifikasi" : "Verify",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL("/staff/cases");
});

test("collapsed settings expand to reveal invalid fields", async ({
  page,
}, info) => {
  const mobile = info.project.name === "mobile-id",
    state = await fixture(page, "admin", mobile);
  state.settings.defaultTeamId = "";
  await page.goto("/staff/admin/settings");
  await expect(
    page.locator('[data-settings-group="routing"]'),
  ).not.toHaveAttribute("open", "");
  await page
    .getByRole("button", { name: mobile ? "Simpan" : "Save", exact: true })
    .click();
  await expect(page.locator('[data-settings-group="routing"]')).toHaveAttribute(
    "open",
    "",
  );
  expect(
    state.requests.some(
      (r) => r.path === "/api/admin/settings" && r.method === "PUT",
    ),
  ).toBe(false);
});
