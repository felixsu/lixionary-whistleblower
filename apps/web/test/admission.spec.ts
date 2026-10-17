import { test, expect } from "@playwright/test";
import { defaultSettings } from "@whistle/shared";
const reportToken = "r".repeat(43),
  challengeId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
for (const scenario of [
  "report",
  "unregistered",
  "disabled",
  "ai",
  "wrong-otp",
  "delivery-error",
  "cancel",
  "expired",
  "cancel-verification",
] as const)
  test(`employee gate: ${scenario}`, async ({ page }, info) => {
    const id = info.project.name === "mobile-id",
      label = (en: string, indo: string) => (id ? indo : en);
    await page.addInitScript(
      (lang) => localStorage.setItem("wb_language", lang),
      id ? "id" : "en",
    );
    const seen: { path: string; body: any; access: string | undefined }[] = [];
    let releaseVerify: (() => void) | undefined;
    const pendingVerify = new Promise<void>((resolve) => {
      releaseVerify = resolve;
    });
    let verifyAttempts = 0;
    let verified = false,
      submitted = false;
    await page.route("**/api/reporter/company", (route) =>
      route.fulfill({
        json: {
          ...defaultSettings,
          version: 1,
          aiEnabled:
            scenario === "ai" ||
            scenario === "unregistered" ||
            scenario === "disabled",
        },
      }),
    );
    await page.route("**/privacy/admission/**", async (route) => {
      const path = new URL(route.request().url()).pathname,
        body = route.request().postDataJSON();
      seen.push({
        path,
        body,
        access: route.request().headers()["x-report-access"],
      });
      if (path.endsWith("challenge") && scenario === "delivery-error")
        return route.fulfill({
          status: 503,
          json: { error: "email_unavailable" },
        });
      if (path.endsWith("challenge"))
        return route.fulfill({
          json:
            scenario === "unregistered" || scenario === "disabled"
              ? { status: scenario }
              : { status: "otp", challengeId, expiresIn: 300, resendAfter: 60 },
        });
      if (path.endsWith("verify")) {
        if (scenario === "wrong-otp" && verifyAttempts++ === 0)
          return route.fulfill({
            status: 400,
            json: { error: "invalid_or_expired_code" },
          });
        if (scenario === "cancel-verification") await pendingVerify;
        verified = true;
        return route.fulfill({
          json: { reportToken, expiresIn: 7200 },
        });
      }
      return route.fulfill({ json: { state: "pending", ok: true } });
    });
    await page.route("**/api/reporter/reports", async (route) => {
      const body = route.request().postDataJSON();
      seen.push({
        path: "/api/reporter/reports",
        body,
        access: route.request().headers()["x-report-access"],
      });
      if (scenario === "expired" && !submitted) {
        submitted = true;
        return route.fulfill({
          status: 401,
          json: { error: "report_access_required" },
        });
      }
      return route.fulfill({
        status: 201,
        json: {
          caseCode: "WB-TEST-1234",
          pin: "synthetic-pin",
          recoveryCode: "synthetic-recovery",
        },
      });
    });
    if (scenario === "ai") {
      await page.goto("/");
      await page
        .getByRole("link", {
          name: label("Create a report", "Buat laporan"),
          exact: true,
        })
        .first()
        .click();
    } else await page.goto("/report");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      page.getByLabel(label("Title", "Judul"), { exact: true }),
    ).toHaveCount(0);
    await expect(dialog.locator('option[value="phone"]')).toHaveAttribute(
      "disabled",
      "",
    );
    await dialog
      .getByLabel("Email", { exact: true })
      .fill("employee@example.test");
    if (scenario === "cancel") {
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await page
        .getByRole("button", {
          name: label("Verify email", "Verifikasi email"),
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("dialog").getByLabel("Email", { exact: true }),
      ).toHaveValue("");
      return;
    }
    await dialog
      .getByRole("button", {
        name: label("Continue", "Lanjutkan"),
        exact: true,
      })
      .click();
    if (scenario === "delivery-error") {
      await expect(dialog.getByRole("alert")).toBeVisible();
      await expect(dialog.getByLabel("Email", { exact: true })).toBeVisible();
      await expect(
        page.getByLabel(label("Title", "Judul"), { exact: true }),
      ).toHaveCount(0);
      expect(verified).toBe(false);
      expect(seen.map((r) => r.path)).toEqual(["/privacy/admission/challenge"]);
      return;
    }
    if (scenario === "unregistered" || scenario === "disabled") {
      await expect(dialog.getByRole("status")).toContainText(
        label(
          scenario === "unregistered"
            ? "This email is not registered"
            : "Your reporting access is disabled",
          scenario === "unregistered"
            ? "Email ini belum terdaftar"
            : "Akses pelaporan Anda dinonaktifkan",
        ),
      );
      await expect(
        page.getByLabel(label("Title", "Judul"), { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", {
          name: label(
            "Use optional assisted intake",
            "Gunakan panduan AI opsional",
          ),
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        dialog.getByLabel(label("Verification code", "Kode verifikasi")),
      ).toHaveCount(0);
      await expect(
        dialog.getByLabel(label("Name", "Nama"), { exact: true }),
      ).toHaveCount(0);
      expect(seen.map((r) => r.path)).toEqual(["/privacy/admission/challenge"]);
      expect(seen[0]!.body.purpose).toBe("report");
      await dialog
        .getByRole("button", {
          name: label("Try another email", "Coba email lain"),
          exact: true,
        })
        .click();
      await expect(dialog.getByLabel("Email", { exact: true })).toHaveValue("");
      await dialog
        .getByRole("button", { name: label("Close", "Tutup"), exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      return;
    }
    await dialog
      .getByLabel(label("Verification code", "Kode verifikasi"), {
        exact: true,
      })
      .fill("123456");
    const verificationResponse =
      scenario === "cancel-verification"
        ? page.waitForResponse((r) =>
            r.url().endsWith("/privacy/admission/verify"),
          )
        : undefined;
    await dialog
      .getByRole("button", { name: label("Verify", "Verifikasi"), exact: true })
      .click();
    if (scenario === "wrong-otp") {
      await expect(dialog.getByRole("alert")).toBeVisible();
      await expect(
        page.getByLabel(label("Title", "Judul"), { exact: true }),
      ).toHaveCount(0);
      expect(verified).toBe(false);
      await dialog
        .getByLabel(label("Verification code", "Kode verifikasi"), {
          exact: true,
        })
        .fill("654321");
      await dialog
        .getByRole("button", {
          name: label("Verify", "Verifikasi"),
          exact: true,
        })
        .click();
    }
    if (scenario === "cancel-verification") {
      await expect
        .poll(() => seen.some((r) => r.path.endsWith("/verify")))
        .toBe(true);
      await dialog
        .getByRole("button", { name: label("Close", "Tutup"), exact: true })
        .click();
      releaseVerify!();
      await (await verificationResponse!).finished();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
      await expect
        .poll(() =>
          seen.some(
            (r) =>
              r.path.endsWith("/cancel") && r.body.reportToken === reportToken,
          ),
        )
        .toBe(true);
      expect(seen.some((r) => r.path.endsWith("/requests"))).toBe(false);
      await expect(
        page.getByLabel(label("Title", "Judul"), { exact: true }),
      ).toHaveCount(0);
      await expect(dialog).toHaveCount(0);
      return;
    }

    await expect(dialog).toHaveCount(0);
    expect(verified).toBe(true);
    await page
      .getByLabel(label("Title", "Judul"), { exact: true })
      .fill("My preserved concern");
    await page
      .getByLabel(label("What happened?", "Apa yang terjadi?"), { exact: true })
      .fill(
        "Synthetic report content that remains anonymous to the review team.",
      );
    await page
      .getByLabel(
        label(
          "I have read the policy and privacy notice.",
          "Saya telah membaca kebijakan dan pemberitahuan privasi.",
        ),
      )
      .check();
    if (scenario === "ai") {
      await page
        .getByLabel(
          label(
            "I consent to MiniMax processing my submitted report and private follow-up conversation. I will review updates before sharing them with investigators.",
            "Saya menyetujui MiniMax memproses laporan terkirim dan percakapan tindak lanjut pribadi saya. Saya akan meninjau pembaruan sebelum membagikannya kepada penyelidik.",
          ),
        )
        .check();
      await expect(
        page.getByRole("button", {
          name: label(
            "Use optional assisted intake",
            "Gunakan panduan AI opsional",
          ),
          exact: true,
        }),
      ).toHaveCount(0);
    }

    await page
      .getByLabel(
        label(
          "I reviewed this content and removed details that could identify me.",
          "Saya telah meninjau isi ini dan menghapus detail yang dapat mengidentifikasi saya.",
        ),
      )
      .check();
    await page
      .getByRole("button", {
        name: label("Submit report", "Kirim laporan"),
        exact: true,
      })
      .click();
    if (scenario === "expired") {
      const retryDialog = page.getByRole("dialog");
      await expect(retryDialog).toBeVisible();
      await expect(
        page.getByLabel(label("Title", "Judul"), { exact: true }),
      ).toHaveValue("My preserved concern");
      await retryDialog
        .getByLabel("Email", { exact: true })
        .fill("employee@example.test");
      await retryDialog
        .getByRole("button", {
          name: label("Continue", "Lanjutkan"),
          exact: true,
        })
        .click();
      await retryDialog
        .getByLabel(label("Verification code", "Kode verifikasi"), {
          exact: true,
        })
        .fill("123456");
      await retryDialog
        .getByRole("button", {
          name: label("Verify", "Verifikasi"),
          exact: true,
        })
        .click();
      await expect(retryDialog).toHaveCount(0);
      expect(
        seen.filter((r) => r.path === "/api/reporter/reports"),
      ).toHaveLength(1);
      expect(
        seen.filter((r) => r.path.endsWith("/verify")).at(-1)?.body.resumeToken,
      ).toBe(reportToken);
      await page
        .getByRole("button", {
          name: label("Submit report", "Kirim laporan"),
          exact: true,
        })
        .click();
    }
    await expect(
      page.getByRole("heading", { name: "WB-TEST-1234" }),
    ).toBeVisible();
    expect(
      seen
        .filter((r) => r.path === "/api/reporter/reports")
        .every((r) => r.access === reportToken),
    ).toBe(true);
    if (scenario === "ai") {
      const report = seen.find((r) => r.path === "/api/reporter/reports");
      expect(report?.body).toMatchObject({ aiConsent: true });
      expect(report?.body).not.toHaveProperty("intakeId");
    }
    expect(
      await page.evaluate(() =>
        JSON.stringify({ ...localStorage, ...sessionStorage }),
      ),
    ).not.toContain(reportToken);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
test("administrator manages employees and reviews access requests", async ({
  page,
}, info) => {
  const id = info.project.name === "mobile-id",
    label = (en: string, indo: string) => (id ? indo : en),
    personId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await page.addInitScript(
    (lang) => localStorage.setItem("wb_language", lang),
    id ? "id" : "en",
  );
  let employees: any[] = [];
  const actions: any[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname,
      method = route.request().method(),
      body = route.request().postData() ? route.request().postDataJSON() : null;
    if (path === "/api/staff/me")
      return route.fulfill({
        json: {
          id: personId,
          email: "admin@example.test",
          name: "Admin",
          role: "admin",
          mfaEnrolled: true,
          mfaVerified: true,
        },
      });
    if (path === "/api/admin/employees" && method === "GET")
      return route.fulfill({
        json: { items: employees, total: employees.length, page: 1 },
      });
    if (path === "/api/admin/employees" && method === "POST") {
      actions.push(body);
      employees = [{ ...body, id: personId }];
      return route.fulfill({ json: { id: personId } });
    }
    if (path === "/api/admin/employee-requests")
      return route.fulfill({
        json: {
          items: [
            {
              id: personId,
              name: "Applicant",
              email: "applicant@example.test",
              phone: "+628123456789",
              state: "pending",
            },
          ],
          total: 1,
          page: 1,
        },
      });
    if (path.endsWith("/resolve")) {
      actions.push(body);
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("/staff/admin/employees");
  await expect(
    page.getByRole("heading", {
      name: label("Employees", "Karyawan"),
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByLabel(label("Name", "Nama"), { exact: true })
    .fill("Registered employee");
  await page.getByLabel("Email", { exact: true }).fill("employee@example.test");
  await page
    .getByLabel(label("Phone number", "Nomor telepon"), { exact: true })
    .fill("+628123456789");
  await page
    .getByRole("button", { name: label("Save", "Simpan"), exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Registered employee", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: label("Account requests", "Permintaan akun"),
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: label("Review request", "Tinjau permintaan"),
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    "applicant@example.test",
  );
  await page
    .getByLabel(label("Name", "Nama"), { exact: true })
    .fill("Corrected applicant");
  await page
    .getByRole("button", {
      name: label("Approve request", "Setujui permintaan"),
      exact: true,
    })
    .click();
  await expect.poll(() => actions.length).toBe(2);
  expect(actions[1]).toMatchObject({
    decision: "approved",
    employee: { name: "Corrected applicant" },
  });
});
