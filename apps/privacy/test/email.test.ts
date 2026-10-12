import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEmailSender,
  emailConfigured,
  loadEmailConfig,
} from "@whistle/runtime";

const transport = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn() }));
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => transport) },
}));
const config = {
  provider: "zoho" as const,
  apiKey: "synthetic-test-credential",
  from: "noreply@example.test",
};
const message = {
  to: "synthetic@example.test",
  subject: "Synthetic test",
  text: "Test-only verification code 123456",
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("email providers", () => {
  it("sends the Zoho contract with tracking disabled and no extra identifying metadata", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [{ code: "EM_104" }] })),
      );
    vi.stubGlobal("fetch", fetch);
    await createEmailSender(config).send(message);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, request] = fetch.mock.calls[0]!;
    expect(url).toBe("https://cpaas.zoho.com/v1.1/email");
    expect(request.redirect).toBe("error");
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(request.headers.authorization).toBe(
      `Zoho-enczapikey ${config.apiKey}`,
    );
    expect(JSON.parse(request.body)).toEqual({
      from: { address: config.from, name: "Speak Up" },
      to: [{ email_address: { address: message.to } }],
      subject: message.subject,
      textbody: message.text,
      track_opens: false,
      track_clicks: false,
    });
  });
  it.each([401, 403, 429, 500, 302])(
    "rejects HTTP %s without retaining provider details",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(`${config.apiKey} ${message.to} ${message.text}`, {
              status,
            }),
          ),
      );
      const error = await createEmailSender(config)
        .send(message)
        .catch((e) => e);
      expect(error.message).toBe("email_delivery_failed");
      expect(JSON.stringify(error)).not.toContain(config.apiKey);
      expect(String(error.stack)).not.toContain(message.to);
      expect(String(error.stack)).not.toContain("123456");
    },
  );
  it.each([
    "invalid json",
    "null",
    "{}",
    '{"data":[{"code":"TM_3004"}]}',
    '{"data":[{"code":"EM_104"}],"error":"sensitive details"}',
  ])("rejects invalid acceptance envelopes: %s", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    await expect(createEmailSender(config).send(message)).rejects.toThrow(
      "email_delivery_failed",
    );
  });
  it.each(["timeout", "network", "redirect"])(
    "sanitizes %s failures",
    async (kind) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockRejectedValue(
            new Error(`${kind} ${config.apiKey} ${message.to} ${message.text}`),
          ),
      );
      await expect(createEmailSender(config).send(message)).rejects.toThrow(
        /^email_delivery_failed$/,
      );
    },
  );
  it("uses a 20-second timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"data":[{"code":"EM_104"}]}')),
    );
    await createEmailSender(config).send(message);
    expect(timeout).toHaveBeenCalledWith(20000);
  });
  it("keeps SMTP configuration and transport behavior compatible", async () => {
    const smtp = loadEmailConfig("PRIVACY", {
      PRIVACY_SMTP_HOST: "mailpit",
      PRIVACY_SMTP_PORT: "1025",
    });
    expect(smtp.provider).toBe("smtp");
    const sender = createEmailSender(smtp);
    transport.sendMail.mockResolvedValue({});
    await sender.send(message);
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: "Speak Up <no-reply@whistle.local>",
      ...message,
    });
    sender.close();
    expect(transport.close).toHaveBeenCalledTimes(1);
    transport.sendMail.mockRejectedValue(new Error(message.to));
    await expect(sender.send(message)).rejects.toThrow(
      /^email_delivery_failed$/,
    );
  });
  it("recognizes provider configuration without SMTP and reads protected key files", async () => {
    const folder = await mkdtemp(join(tmpdir(), "wb-email-config-"));
    try {
      const key = join(folder, "secret");
      await writeFile(key, `Zoho-enczapikey ${config.apiKey}\n`, {
        mode: 0o600,
      });
      for (const scope of ["STAFF", "PRIVACY"] as const) {
        const loaded = loadEmailConfig(scope, {
          [`${scope}_EMAIL_PROVIDER`]: "zoho",
          [`${scope}_EMAIL_FROM`]: config.from,
          ZOHO_API_KEY_FILE: key,
        });
        expect(emailConfigured(loaded)).toBe(true);
        expect(loaded).toEqual(config);
      }
      expect(emailConfigured({ ...config, apiKey: "" })).toBe(false);
      expect(emailConfigured({ ...config, from: "invalid" })).toBe(false);
      await expect(
        createEmailSender({ ...config, apiKey: "" }).send(message),
      ).rejects.toThrow("email_unavailable");
      expect(() =>
        loadEmailConfig("STAFF", { STAFF_EMAIL_PROVIDER: "unknown" }),
      ).toThrow("email_provider_invalid");
      expect(() =>
        loadEmailConfig("STAFF", {
          STAFF_EMAIL_PROVIDER: "zoho",
          ZOHO_API_KEY_FILE: join(folder, "missing"),
        }),
      ).toThrow("email_configuration_invalid");
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
  it("refuses recipient lists and header injection before making a request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      createEmailSender(config).send({
        ...message,
        to: "one@example.test,two@example.test",
      }),
    ).rejects.toThrow("email_message_invalid");
    await expect(
      createEmailSender(config).send({
        ...message,
        subject: "subject\r\nBcc: other@example.test",
      }),
    ).rejects.toThrow("email_message_invalid");
    expect(fetch).not.toHaveBeenCalled();
  });
});
