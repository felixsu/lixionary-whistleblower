import nodemailer from "nodemailer";
import type { Config } from "../config.js";

export interface Mail {
  to: string[];
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export function createMailer(config: Config["mail"], log: (msg: string) => void): Mailer {
  if (!config.host) {
    return {
      async send(mail) {
        log(`SMTP not configured; would email ${mail.to.length} admin(s): ${mail.subject}`);
      },
    };
  }
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
  });
  return {
    async send(mail) {
      // bcc so admins don't see each other's addresses.
      await transport.sendMail({ from: config.from, bcc: mail.to, subject: mail.subject, text: mail.text });
    },
  };
}
