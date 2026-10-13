import { afterEach, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { seal, token } from "@whistle/runtime";
import { startJobs } from "../src/jobs.js";
import { loadConfig } from "../src/config.js";
import type { Db } from "../src/db/client.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function exercise(rejected: boolean, staffToken = false) {
  vi.useFakeTimers();
  const config = loadConfig({
    NODE_ENV: "test",
    SUITE_DATABASE_URL: "unused",
    REDIS_URL: "unused",
    CASE_KEYRING: JSON.stringify({
      active: "a",
      keys: { a: randomBytes(32).toString("base64") },
    }),
    CAPABILITY_PRIVATE_KEY: "unused",
    SERVICE_EVENT_KEY: "unused",
    ABUSE_KEY: "unused",
    STAFF_EMAIL_PROVIDER: "zoho",
    STAFF_EMAIL_FROM: "noreply@example.test",
    ZOHO_API_KEY: randomBytes(16).toString("hex"),
  });
  const raw = token();
  let claimed = false,
    sent = false,
    retry = false;
  const db = {
    async execute(query: SQL) {
      const sql = new PgDialect().sqlToQuery(query).sql;
      if (
        sql.startsWith("update jobs set lease_at") &&
        sql.includes("attempts=attempts+1")
      ) {
        if (claimed) return [];
        claimed = true;
        return [
          {
            id: randomUUID(),
            kind: staffToken ? "staff_token" : "staff_alert",
            staff_id: randomUUID(),
            body: staffToken
              ? {
                  tokenEnc: seal(raw, config.keys, "staff-token"),
                  purpose: "password_reset",
                }
              : {},
            case_id: randomUUID(),
            attempts: 1,
            lease_at: new Date(),
          },
        ];
      }
      if (
        sql.startsWith("select distinct s.email") ||
        sql.startsWith("select email from staff")
      )
        return [{ email: "synthetic-staff@example.test" }];
      if (sql.startsWith("update jobs set sent_at")) sent = true;
      if (sql.includes("error_code='delivery_failed'")) retry = true;
      return [];
    },
  } as unknown as Db;
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(
        rejected ? "provider failure" : '{"data":[{"code":"EM_104"}]}',
        { status: rejected ? 429 : 200 },
      ),
    );
  vi.stubGlobal("fetch", fetch);
  const log = { error: vi.fn() };
  const stop = startJobs(db, config, log);
  try {
    await vi.waitFor(() => expect(sent || retry).toBe(true));
    expect(sent).toBe(!rejected);
    expect(retry).toBe(rejected);
    expect(fetch).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fetch.mock.calls[0]![1].body);
    expect(payload.to[0].email_address.address).toBe(
      "synthetic-staff@example.test",
    );
    expect(payload.textbody).toContain("/staff");
    if (staffToken)
      expect(payload.textbody).toContain("/staff/accept#token=" + raw);
    expect(JSON.stringify(log.error.mock.calls)).not.toContain(
      "synthetic-staff@example.test",
    );
  } finally {
    stop();
  }
}
it("staff worker marks accepted Zoho alerts sent", () => exercise(false));
it("staff worker retries throttled Zoho alerts", () => exercise(true));

it("staff worker delivers password reset links", () => exercise(false, true));
it("staff worker retries failed password reset delivery", () =>
  exercise(true, true));
