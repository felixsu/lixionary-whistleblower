import { z } from "zod";
export const locales = ["en", "id"] as const;
export type Locale = (typeof locales)[number];
export const staffRoles = ["admin", "manager", "analyst"] as const;
export type StaffRole = (typeof staffRoles)[number];
export const states = [
  "received",
  "triage",
  "investigating",
  "waiting_reporter",
  "closure_review",
  "closed",
] as const;
export type CaseState = (typeof states)[number];
export const outcomes = [
  "substantiated",
  "partially_substantiated",
  "unsubstantiated",
  "out_of_scope",
  "duplicate",
  "withdrawn",
] as const;
export const suiteReportSchema = z.object({
  title: z.string().trim().min(5).max(200),
  summary: z.string().trim().min(20).max(10000),
  category: z.string().trim().min(1).max(80),
  businessUnit: z.string().max(100).default(""),
  details: z.record(z.string().max(50), z.string().max(5000)).default({}),
  locale: z.enum(locales).default("en"),
  sensitive: z.boolean().default(false),
  privacyReviewed: z.literal(true),
  policyVersion: z.number().int().positive(),
  intakeId: z.uuid().optional(),
  intakeToken: z.string().min(20).max(200).optional(),
});
export type SuiteReport = z.infer<typeof suiteReportSchema>;
export const bodySchema = z.object({
  body: z.string().trim().min(1).max(10000),
  privacyReviewed: z.literal(true).optional(),
});
export const retentionSchema = z.object({
  cases: z.number().int().min(1).max(36500),
  contacts: z.number().int().min(1).max(36500),
  evidence: z.number().int().min(1).max(36500),
  transcripts: z.number().int().min(1).max(36500),
  audit: z.number().int().min(1).max(36500),
  backups: z.number().int().min(1).max(36500),
});
export const settingsSchema = z
  .object({
    companyName: z.string().trim().min(1).max(100).default("Speak Up"),
    policy: z.object({
      en: z.string().min(20).max(20000),
      id: z.string().min(20).max(20000),
    }),
    privacyNotice: z.object({
      en: z.string().min(20).max(20000),
      id: z.string().min(20).max(20000),
    }),
    categories: z
      .array(
        z.object({
          key: z
            .string()
            .regex(/^[a-z0-9_]+$/)
            .max(80),
          en: z.string().min(1).max(100),
          id: z.string().min(1).max(100),
        }),
      )
      .min(1)
      .max(50),
    businessUnits: z
      .array(z.string().trim().min(1).max(100))
      .max(100)
      .default([]),
    aiEnabled: z.boolean().default(false),
    acknowledgmentDays: z.number().int().min(1).max(365),
    followupDays: z.number().int().min(1).max(365),
    retention: retentionSchema.nullable().default(null),
    defaultTeamId: z.uuid().nullable().default(null),
    restrictedTeamId: z.uuid().nullable().default(null),
    notificationTemplates: z.object({
      en: z.string().min(10).max(300),
      id: z.string().min(10).max(300),
    }),
  })
  .superRefine((s, c) => {
    if (new Set(s.categories.map((x) => x.key)).size !== s.categories.length)
      c.addIssue({ code: "custom", message: "Duplicate category" });
    if (s.defaultTeamId && s.defaultTeamId === s.restrictedTeamId)
      c.addIssue({
        code: "custom",
        message: "Restricted team must be independent",
      });
  });
export type CompanySettings = z.infer<typeof settingsSchema>;
export const defaultSettings: CompanySettings = {
  companyName: "Speak Up",
  policy: {
    en: "Report suspected misconduct in good faith. Your report will be reviewed through this platform.",
    id: "Laporkan dugaan pelanggaran dengan itikad baik. Laporan Anda akan ditinjau melalui platform ini.",
  },
  privacyNotice: {
    en: "Employee email verification is required before reporting. Administrators manage the employee directory, but employee identity is not included in reports. Optional case contacts are hidden from staff. Report content and circumstances may identify you. External delivery providers process destinations; optional AI processes your conversation only with consent.",
    id: "Verifikasi email karyawan wajib dilakukan sebelum melapor. Administrator mengelola daftar karyawan, tetapi identitas karyawan tidak disertakan dalam laporan. Kontak laporan opsional disembunyikan dari staf. Isi dan situasi laporan dapat mengidentifikasi Anda. Penyedia pengiriman eksternal memproses tujuan; AI opsional memproses percakapan hanya dengan persetujuan.",
  },
  categories: [
    { key: "fraud", en: "Fraud", id: "Penipuan" },
    { key: "corruption", en: "Corruption or bribery", id: "Korupsi atau suap" },
    { key: "harassment", en: "Harassment", id: "Pelecehan" },
    { key: "safety", en: "Health and safety", id: "Kesehatan dan keselamatan" },
    { key: "other", en: "Other misconduct", id: "Pelanggaran lainnya" },
  ],
  businessUnits: [],
  aiEnabled: false,
  acknowledgmentDays: 7,
  followupDays: 30,
  retention: null,
  defaultTeamId: null,
  restrictedTeamId: null,
  notificationTemplates: {
    en: "There is an update in your private reporting portal. Visit the platform to check it.",
    id: "Ada pembaruan di portal laporan pribadi Anda. Kunjungi platform untuk memeriksanya.",
  },
};
export interface StaffIdentity {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  mfaEnrolled: boolean;
}
export interface CaseView {
  id: string;
  caseCode: string;
  state: CaseState;
  category: string;
  sensitive: boolean;
  severity: string;
  ownerId: string | null;
  teamId: string | null;
  content: SuiteReport;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  hold: boolean;
  closure: Record<string, unknown> | null;
  verification: { state: string; verifiedAt: string | null };
  messages: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  notes: Record<string, unknown>[];
  findings: Record<string, unknown>[];
  evidence: Record<string, unknown>[];
  audit: Record<string, unknown>[];
  members: Record<string, unknown>[];
}
