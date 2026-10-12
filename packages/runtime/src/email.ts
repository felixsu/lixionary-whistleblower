import { readFileSync } from "node:fs";
import nodemailer from "nodemailer";
import { z } from "zod";

export type EmailMessage = { to: string; subject: string; text: string };
export type EmailConfig =
  | {
      provider: "smtp";
      host: string;
      port: number;
      secure: boolean;
      user: string;
      pass: string;
      from: string;
    }
  | { provider: "zoho"; apiKey: string; from: string };

export class EmailError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "EmailError";
  }
}

function optionalSecret(name: string, env: NodeJS.ProcessEnv) {
  try {
    return (
      env[`${name}_FILE`]
        ? readFileSync(env[`${name}_FILE`]!, "utf8")
        : (env[name] ?? "")
    ).trim();
  } catch {
    throw new EmailError("email_configuration_invalid");
  }
}

export function loadEmailConfig(
  scope: "STAFF" | "PRIVACY",
  env: NodeJS.ProcessEnv = process.env,
): EmailConfig {
  const provider = env[`${scope}_EMAIL_PROVIDER`] ?? "smtp";
  if (provider === "zoho") {
    const apiKey = optionalSecret("ZOHO_API_KEY", env).replace(
      /^Zoho-enczapikey\s+/i,
      "",
    );
    if (/\s/.test(apiKey)) throw new EmailError("email_configuration_invalid");
    return { provider, apiKey, from: env[`${scope}_EMAIL_FROM`] ?? "" };
  }
  if (provider !== "smtp") throw new EmailError("email_provider_invalid");
  return {
    provider,
    host: env[`${scope}_SMTP_HOST`] ?? "",
    port: Number(env[`${scope}_SMTP_PORT`] ?? 6404),
    secure: env[`${scope}_SMTP_PORT`] === "465",
    user: env[`${scope}_SMTP_USER`] ?? "",
    pass: optionalSecret(`${scope}_SMTP_PASS`, env),
    from: env[`${scope}_SMTP_FROM`] ?? "Speak Up <no-reply@whistle.local>",
  };
}

export function emailConfigured(config: EmailConfig): boolean {
  return config.provider === "smtp"
    ? Boolean(config.host && config.from)
    : Boolean(config.apiKey && z.email().safeParse(config.from).success);
}

export function createEmailSender(config: EmailConfig) {
  const configured = emailConfigured(config);
  const smtp =
    config.provider === "smtp" && configured
      ? nodemailer.createTransport({
          host: config.host,
          port: config.port,
          secure: config.secure,
          auth: config.user
            ? { user: config.user, pass: config.pass }
            : undefined,
          connectionTimeout: 10000,
          socketTimeout: 20000,
        })
      : undefined;
  return {
    configured,
    async send(message: EmailMessage): Promise<void> {
      if (!configured) throw new EmailError("email_unavailable");
      if (
        !z.email().safeParse(message.to).success ||
        /[\r\n]/.test(message.subject)
      )
        throw new EmailError("email_message_invalid");
      if (smtp) {
        try {
          await smtp.sendMail({ from: config.from, ...message });
          return;
        } catch {
          throw new EmailError("email_delivery_failed");
        }
      }
      if (config.provider !== "zoho") throw new EmailError("email_unavailable");
      try {
        const response = await fetch("https://cpaas.zoho.com/v1.1/email", {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(20000),
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            authorization: `Zoho-enczapikey ${config.apiKey}`,
          },
          body: JSON.stringify({
            from: { address: config.from, name: "Speak Up" },
            to: [{ email_address: { address: message.to } }],
            subject: message.subject,
            textbody: message.text,
            track_opens: false,
            track_clicks: false,
          }),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new EmailError("email_delivery_failed");
        }
        const result = (await response.json()) as {
          data?: { code?: string }[];
          error?: unknown;
        };
        if (
          result?.error ||
          !Array.isArray(result?.data) ||
          result.data.length !== 1 ||
          result.data[0]?.code !== "EM_104"
        )
          throw new EmailError("email_delivery_failed");
      } catch {
        // Provider responses can echo addresses/body/credentials. Never retain them.
        throw new EmailError("email_delivery_failed");
      }
    },
    close() {
      smtp?.close();
    },
  };
}
