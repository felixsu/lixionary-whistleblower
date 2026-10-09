import { resolve } from "node:path";
import { z } from "zod";

const encryptionKey = z
  .string()
  .min(1, "CONTACT_ENC_KEY is required (generate with: openssl rand -base64 32)")
  .transform((value, ctx) => {
    const key = Buffer.from(value, "base64");
    if (key.length !== 32) {
      ctx.addIssue({ code: "custom", message: "CONTACT_ENC_KEY must be 32 bytes, base64-encoded" });
      return z.NEVER;
    }
    return key;
  });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().default(6400),
  TRUST_PROXY: z.stringbool().default(false),
  DATABASE_URL: z.string().min(1),
  CONTACT_ENC_KEY: encryptionKey,
  UPLOAD_DIR: z.string().default("./data/uploads"),
  COOKIE_SECURE: z.stringbool().default(false),
  MINIMAX_API_KEY: z.string().default(""),
  MINIMAX_BASE_URL: z.url().default("https://api.minimax.io/v1"),
  MINIMAX_MODEL: z.string().default("MiniMax-M3"),
  MINIMAX_THINKING: z.enum(["disabled", "adaptive"]).default("disabled"),
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  SMTP_FROM: z.string().default("Whistleblower <no-reply@whistle.local>"),
  PUBLIC_WEB_URL: z.url().default("http://localhost:6401"),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    trustProxy: e.TRUST_PROXY,
    databaseUrl: e.DATABASE_URL,
    contactKey: e.CONTACT_ENC_KEY,
    uploadDir: resolve(e.UPLOAD_DIR),
    cookieSecure: e.COOKIE_SECURE,
    ai: {
      apiKey: e.MINIMAX_API_KEY,
      baseUrl: e.MINIMAX_BASE_URL,
      model: e.MINIMAX_MODEL,
      thinking: e.MINIMAX_THINKING,
    },
    mail: {
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      user: e.SMTP_USER,
      pass: e.SMTP_PASS,
      from: e.SMTP_FROM,
    },
    publicWebUrl: e.PUBLIC_WEB_URL.replace(/\/$/, ""),
  };
}
