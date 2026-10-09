import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDb, type Db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { admins } from "../src/db/schema.js";
import { hashSecret } from "../src/crypto/password.js";
import { createDiskStorage, type Storage } from "../src/lib/storage.js";
import type { AiClient, LlmMessage } from "../src/ai/minimax.js";

export const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://whistle:whistle@127.0.0.1:6402/whistle_test";

let migrated = false;
async function ensureDatabase(): Promise<void> {
  if (migrated) return;
  const url = new URL(TEST_DB_URL);
  const dbName = url.pathname.slice(1);
  url.pathname = "/postgres";
  const admin = postgres(url.toString(), { onnotice: () => {} });
  const exists = await admin`select 1 from pg_database where datname = ${dbName}`;
  if (exists.length === 0) await admin.unsafe(`create database "${dbName}"`);
  await admin.end();
  await runMigrations(TEST_DB_URL);
  migrated = true;
}

/** A scripted stand-in for MiniMax. */
export class FakeAi implements AiClient {
  enabled = true;
  replies: string[] = ["Thanks. When did this happen?"];
  completions: string[] = [];
  calls: LlmMessage[][] = [];
  failStream = false;

  async *stream(messages: LlmMessage[]) {
    this.calls.push(messages);
    if (this.failStream) throw new Error("upstream down");
    const reply = this.replies.shift() ?? "Could you tell me more?";
    for (let i = 0; i < reply.length; i += 5) yield reply.slice(i, i + 5);
  }

  async complete(messages: LlmMessage[]) {
    this.calls.push(messages);
    return this.completions.shift() ?? "{}";
  }
}

export interface TestContext {
  app: FastifyInstance;
  db: Db;
  ai: FakeAi;
  storage: Storage;
  uploadDir: string;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestContext> {
  await ensureDatabase();
  const uploadDir = mkdtempSync(join(tmpdir(), "whistle-test-"));
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: TEST_DB_URL,
    CONTACT_ENC_KEY: randomBytes(32).toString("base64"),
    UPLOAD_DIR: uploadDir,
  });
  const { db, close } = createDb(TEST_DB_URL);
  await db.execute(sql`truncate admins, admin_sessions, intake_sessions, intake_messages, reports,
    report_messages, report_notes, attachments, audit_log, notification_outbox restart identity cascade`);
  const ai = new FakeAi();
  const storage = createDiskStorage(uploadDir);
  const app = await buildApp({ config, db, ai, storage });
  return {
    app,
    db,
    ai,
    storage,
    uploadDir,
    async close() {
      await app.close();
      await close();
    },
  };
}

export async function createAdmin(db: Db, email = "admin@example.com", password = "correct horse battery") {
  await db.insert(admins).values({ email, name: "Test Admin", passwordHash: await hashSecret(password) });
  return { email, password };
}

export async function loginCookie(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/admin/login",
    headers: { "x-csrf": "1" },
    payload: { email, password },
  });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === "wb_admin");
  return `wb_admin=${cookie!.value}`;
}

export function parseSse(body: string): { type: string; [k: string]: unknown }[] {
  return body
    .split("\n\n")
    .filter((e) => e.startsWith("data: "))
    .map((e) => JSON.parse(e.slice(6)));
}

export const sampleReport = {
  category: "corruption_bribery",
  title: "Kickbacks in vendor selection",
  summary: "A procurement manager appears to receive payments from a vendor in exchange for contracts.",
  details: {
    what: "Vendor payments to manager",
    who: "Procurement manager, Vendor Z",
    when: "March to May 2026",
    where: "Jakarta office",
    howKnown: "Saw emails",
    evidence: "Email copies",
    impact: "Overpriced contracts",
    ongoing: "yes",
  },
};
