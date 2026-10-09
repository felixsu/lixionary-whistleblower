import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import {
  REPORT_STATUSES,
  REPORT_CATEGORIES,
  CONTACT_PREFERENCES,
  type ReportDraft,
  type ReportDetails,
} from "@whistle/shared";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const reportStatusEnum = pgEnum("report_status", REPORT_STATUSES);
export const reportCategoryEnum = pgEnum("report_category", REPORT_CATEGORIES);
export const contactPreferenceEnum = pgEnum("contact_preference", CONTACT_PREFERENCES);
export const messageAuthorEnum = pgEnum("message_author", ["admin", "reporter"]);
export const chatRoleEnum = pgEnum("chat_role", ["user", "assistant"]);

export const admins = pgTable("admins", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => admins.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("admin_sessions_expires_idx").on(t.expiresAt)],
);

/** An anonymous, pre-submission conversation with the AI assistant. */
export const intakeSessions = pgTable(
  "intake_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    draft: jsonb("draft").$type<ReportDraft>().notNull(),
    completeness: integer("completeness").notNull().default(0),
    missing: jsonb("missing").$type<string[]>().notNull().default([]),
    turnCount: integer("turn_count").notNull().default(0),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
  },
  (t) => [index("intake_sessions_expires_idx").on(t.expiresAt)],
);

export const intakeMessages = pgTable(
  "intake_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => intakeSessions.id, { onDelete: "cascade" }),
    role: chatRoleEnum("role").notNull(),
    content: text("content").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("intake_messages_session_idx").on(t.sessionId, t.createdAt)],
);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseCode: text("case_code").notNull().unique(),
    pinHash: text("pin_hash").notNull(),
    category: reportCategoryEnum("category").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    details: jsonb("details").$type<ReportDetails>().notNull(),
    completeness: integer("completeness").notNull().default(0),
    missing: jsonb("missing").$type<string[]>().notNull().default([]),
    contactEmailEnc: text("contact_email_enc"),
    contactPhoneEnc: text("contact_phone_enc"),
    contactPreference: contactPreferenceEnum("contact_preference").notNull().default("either"),
    status: reportStatusEnum("status").notNull().default("new"),
    intakeSessionId: uuid("intake_session_id")
      .unique()
      .references(() => intakeSessions.id, { onDelete: "set null" }),
    adminLastReadAt: timestamp("admin_last_read_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("reports_status_idx").on(t.status),
    index("reports_created_idx").on(t.createdAt),
  ],
);

/** Two-way thread between admins and the reporter (reporter reads it via case code + PIN). */
export const reportMessages = pgTable(
  "report_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    author: messageAuthorEnum("author").notNull(),
    adminId: uuid("admin_id").references(() => admins.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("report_messages_report_idx").on(t.reportId, t.createdAt)],
);

/** Internal notes, never shown to the reporter. */
export const reportNotes = pgTable(
  "report_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    adminId: uuid("admin_id").references(() => admins.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("report_notes_report_idx").on(t.reportId)],
);

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    intakeSessionId: uuid("intake_session_id").references(() => intakeSessions.id, {
      onDelete: "set null",
    }),
    reportId: uuid("report_id").references(() => reports.id, { onDelete: "cascade" }),
    originalName: text("original_name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [
    index("attachments_report_idx").on(t.reportId),
    index("attachments_intake_idx").on(t.intakeSessionId),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminId: uuid("admin_id").references(() => admins.id, { onDelete: "set null" }),
    reportId: uuid("report_id").references(() => reports.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_report_idx").on(t.reportId, t.createdAt)],
);

export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [index("notification_outbox_pending_idx").on(t.sentAt, t.nextAttemptAt)],
);
