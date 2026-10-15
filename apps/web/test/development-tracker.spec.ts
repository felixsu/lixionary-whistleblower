import { test, expect, type Page } from "@playwright/test";
import { safeStaffReturn } from "../src/components/suite/staff-navigation";

const path = "/staff/admin/development-tracker";
const jiraOrigin = "https://jira.example.test";
const statuses = [
  "pending",
  "todo",
  "in_progress",
  "pending_release",
  "closed",
];

async function fixture(page: Page, mobile: boolean, role = "admin") {
  await page.addInitScript(
    (language) => localStorage.setItem("wb_language", language),
    mobile ? "id" : "en",
  );
  const state = {
    enabled: true,
    statusFailure: false,
    boardFailure: false,
    launchFailure: false,
    badLaunch: false,
    expired: false,
    delay: 0,
    boardReads: 0,
    launches: [] as { type: string }[],
    queries: [] as string[],
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const send = (json: unknown, status = 200) =>
      route.fulfill({ json, status });
    if (url.pathname === "/api/staff/me")
      return send({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "Synthetic admin",
        email: "admin@example.test",
        role,
        mfaEnrolled: true,
        mfaVerified: true,
      });
    if (url.pathname === "/api/admin/jira")
      return state.statusFailure
        ? send({ error: "jira_unavailable" }, 503)
        : send({
            enabled: state.enabled,
            origin: jiraOrigin,
            projectKey: "LWB",
          });
    if (url.pathname === "/api/admin/jira/board") {
      state.boardReads++;
      state.queries.push(url.search);
      if (state.boardFailure) return send({ error: "jira_unavailable" }, 503);
      const column = url.searchParams.get("column");
      const more = !!url.searchParams.get("offset");
      return send({
        project: { key: "LWB", name: "Whistleblower" },
        columns: (column ? [column] : statuses).map((status) => ({
          status,
          total: status === "pending" ? 26 : 0,
          nextOffset: status === "pending" && !more ? 25 : null,
          cards:
            status === "pending"
              ? [
                  {
                    key: more ? "LWB-26" : "LWB-1",
                    title: more
                      ? "Another feature"
                      : "Synthetic software request",
                    type: "feature_request",
                    status,
                    resolution: null,
                  },
                ]
              : [],
        })),
      });
    }
    if (url.pathname === "/api/admin/jira/intake") {
      state.launches.push(request.postDataJSON());
      expect((await request.allHeaders())["x-csrf"]).toBe("1");
      if (state.delay)
        await new Promise((resolve) => setTimeout(resolve, state.delay));
      if (state.launchFailure) return send({ error: "jira_unavailable" }, 503);
      return send({
        launchUrl: `${state.badLaunch ? "https://evil.example" : jiraOrigin}/intake`,
        origin: jiraOrigin,
        expiresAt: new Date(
          Date.now() + (state.expired ? -60000 : 60000),
        ).toISOString(),
      });
    }
    return send({});
  });
  await page.context().route(`${jiraOrigin}/**`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<html><body><h1>Synthetic Jira form</h1></body></html>",
    }),
  );
  return state;
}

test("admin navigation, board pagination, popup attribution and refresh", async ({
  page,
}, info) => {
  const mobile = info.project.name === "mobile-id";
  const label = (en: string, id: string) => (mobile ? id : en);
  const state = await fixture(page, mobile);
  expect(safeStaffReturn(path)).toBe(path);
  await page.goto(path);
  await expect(
    page.getByRole("heading", {
      name: label("Development Tracker", "Pelacak Pengembangan"),
      exact: true,
    }),
  ).toBeVisible();
  if (mobile)
    await page.getByRole("button", { name: "Menu", exact: true }).click();
  const nav = mobile ? page.getByRole("dialog") : page.locator("aside");
  await expect(
    nav
      .getByRole("group", {
        name: label("Administration", "Administrasi"),
        exact: true,
      })
      .getByRole("link", {
        name: label("Development Tracker", "Pelacak Pengembangan"),
        exact: true,
      }),
  ).toHaveAttribute("aria-current", "page");
  if (mobile) await page.getByRole("button", { name: "Tutup menu" }).click();
  await expect(page.locator(".jira-column")).toHaveCount(5);
  await expect(
    page.getByText("Synthetic software request", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: label("Load more", "Muat lainnya") })
    .click();
  await expect(
    page.getByText("Another feature", { exact: true }),
  ).toBeVisible();
  expect(state.queries).toContain("?column=pending&offset=25");

  for (const [type, name] of [
    ["issue", label("Report an error", "Laporkan kesalahan")],
    ["feature_request", label("Request a feature", "Ajukan fitur")],
  ]) {
    const opened = page.waitForEvent("popup");
    await page.getByRole("button", { name: name }).click();
    const popup = await opened;
    await expect(popup).toHaveURL(`${jiraOrigin}/intake`);
    expect(state.launches.at(-1)).toEqual({ type });
    const origin = new URL(page.url()).origin;
    const reads = state.boardReads;
    // Right origin, wrong window; right popup, wrong origin or project: none may refresh the board.
    await page.evaluate(
      (origin) =>
        window.dispatchEvent(
          new MessageEvent("message", {
            origin,
            source: window,
            data: { type: "lixionary-jira:ticket-created", key: "LWB-999" },
          }),
        ),
      jiraOrigin,
    );
    await page.evaluate(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://evil.example",
          data: { type: "lixionary-jira:ticket-created", key: "LWB-999" },
        }),
      ),
    );
    await popup.evaluate(
      (origin) =>
        window.opener.postMessage(
          { type: "lixionary-jira:ticket-created", key: "LDF-999" },
          origin,
        ),
      origin,
    );
    await expect(page.getByText(/LWB-999/)).toHaveCount(0);
    expect(state.boardReads).toBe(reads);
    await popup.evaluate(
      (origin) =>
        window.opener.postMessage(
          {
            type: "lixionary-jira:ticket-created",
            key: "LWB-42",
            title: "Created",
            status: "pending",
          },
          origin,
        ),
      origin,
    );
    await expect(
      page.getByRole("status").filter({ hasText: "LWB-42" }),
    ).toBeVisible();
    await expect.poll(() => state.boardReads).toBeGreaterThan(reads);
    await popup.close();
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/development-tracker-${info.project.name}.png`,
    fullPage: true,
  });
});

test("disabled, unavailable, empty and recoverable board states", async ({
  page,
}, info) => {
  const mobile = info.project.name === "mobile-id";
  const state = await fixture(page, mobile);
  state.enabled = false;
  await page.goto(path);
  await expect(page.getByRole("status")).toContainText(
    mobile ? "belum dikonfigurasi" : "not configured",
  );
  await expect(
    page.getByRole("button", {
      name: mobile ? "Laporkan kesalahan" : "Report an error",
    }),
  ).toHaveCount(0);
  state.enabled = true;
  state.statusFailure = true;
  await page.reload();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    mobile ? "tidak tersedia" : "unavailable",
  );
  state.statusFailure = false;
  state.boardFailure = true;
  await page
    .getByRole("button", {
      name: mobile ? "Muat ulang papan" : "Refresh board",
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: mobile ? "Laporkan kesalahan" : "Report an error",
    }),
  ).toBeEnabled();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  state.boardFailure = false;
  await page
    .getByRole("button", {
      name: mobile ? "Muat ulang papan" : "Refresh board",
    })
    .click();
  await expect(page.locator(".jira-column")).toHaveCount(5);
  await expect(
    page.getByText(mobile ? "Belum ada tiket." : "No tickets here."),
  ).toHaveCount(4);
});

test("blocked popups, launch failure and untrusted or expired launch URLs", async ({
  page,
}, info) => {
  const mobile = info.project.name === "mobile-id";
  const state = await fixture(page, mobile);
  await page.goto(path);
  const report = page.getByRole("button", {
    name: mobile ? "Laporkan kesalahan" : "Report an error",
  });
  await expect(report).toBeEnabled();
  await page.evaluate(() => {
    window.open = () => null;
  });
  await report.click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    mobile ? "Izinkan pop-up" : "Allow pop-ups",
  );
  expect(state.launches).toHaveLength(0);
  await page.reload();
  state.launchFailure = true;
  for (const reason of ["failure", "origin", "expired"]) {
    state.launchFailure = reason === "failure";
    state.badLaunch = reason === "origin";
    state.expired = reason === "expired";
    const opened = page.waitForEvent("popup");
    await report.click();
    const popup = await opened;
    await expect.poll(() => popup.isClosed()).toBe(true);
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    expect(popup.url()).not.toContain("evil.example");
  }
});

test("popup opens before a slow launch request and an unfinished report is preserved", async ({
  page,
}, info) => {
  const mobile = info.project.name === "mobile-id";
  const state = await fixture(page, mobile);
  state.delay = 800;
  await page.goto(path);
  const report = page.getByRole("button", {
    name: mobile ? "Laporkan kesalahan" : "Report an error",
  });
  const opened = page.waitForEvent("popup");
  await report.click();
  const popup = await opened;
  expect(popup.url()).toBe("about:blank");
  await expect(report).toBeDisabled();
  await expect(popup).toHaveURL(`${jiraOrigin}/intake`);
  await expect(report).toBeEnabled();
  await report.click();
  expect(state.launches).toHaveLength(1);
  await popup.close();
});

test("non-admins cannot enter the tracker and do not request Jira data", async ({
  page,
}, info) => {
  const mobile = info.project.name === "mobile-id";
  const state = await fixture(page, mobile, "analyst");
  await page.goto(path);
  await expect(
    page.getByRole("heading", {
      name: mobile
        ? "Anda tidak memiliki akses ke halaman ini"
        : "You do not have access to this page",
    }),
  ).toBeVisible();
  expect(state.boardReads).toBe(0);
  expect(state.launches).toHaveLength(0);
});
