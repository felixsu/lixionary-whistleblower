import { z } from "zod";

export const jiraTicketType = z.enum(["issue", "feature_request"]);
export const jiraStatus = z.enum([
  "pending",
  "todo",
  "in_progress",
  "pending_release",
  "closed",
]);
export const jiraIntakeInput = z.object({ type: jiraTicketType }).strict();
export const jiraBoardQuery = z
  .object({
    column: jiraStatus.optional(),
    offset: z.coerce
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
  })
  .strict()
  .refine((v) => v.offset === undefined || v.column !== undefined, {
    message: "A column is required with an offset",
    path: ["column"],
  });
export const jiraLaunchSchema = z.object({
  launchUrl: z.url(),
  origin: z.url(),
  expiresAt: z.iso.datetime({ offset: true }),
});
export const jiraBoardSchema = z.object({
  project: z.object({ key: z.string(), name: z.string() }),
  columns: z.array(
    z.object({
      status: jiraStatus,
      total: z.number().int().nonnegative(),
      nextOffset: z.number().int().nonnegative().nullable(),
      cards: z.array(
        z.object({
          key: z.string().regex(/^LWB-\d+$/),
          title: z.string().max(200),
          type: jiraTicketType,
          status: jiraStatus,
          resolution: z.enum(["done", "rejected"]).nullable(),
        }),
      ),
    }),
  ),
});
export type JiraBoard = z.infer<typeof jiraBoardSchema>;
export type JiraStatus = z.infer<typeof jiraStatus>;
export type JiraTicketType = z.infer<typeof jiraTicketType>;
export type JiraLaunch = z.infer<typeof jiraLaunchSchema>;
export type JiraSupport = {
  enabled: boolean;
  origin?: string;
  projectKey?: string;
};
