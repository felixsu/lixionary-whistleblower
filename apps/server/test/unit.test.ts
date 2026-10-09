import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CASE_CODE_PATTERN, contactSchema, normalizeCaseCode } from "@whistle/shared";
import { decryptContact, encryptContact } from "../src/crypto/contact.js";
import { newCaseCode, newPin, normalizePin } from "../src/crypto/tokens.js";
import { ThinkFilter } from "../src/ai/minimax.js";
import { MarkerStripper } from "../src/lib/markers.js";
import { parseAssessment } from "../src/ai/extract.js";
import { estimateCompleteness } from "../src/routes/reports.js";

const key = randomBytes(32);

describe("contact encryption", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptContact("reporter@example.com", key);
    const b = encryptContact("reporter@example.com", key);
    expect(a).not.toBe(b);
    expect(a.startsWith("v1:")).toBe(true);
    expect(decryptContact(a, key)).toBe("reporter@example.com");
  });

  it("detects tampering and wrong keys", () => {
    const enc = encryptContact("+62 812 3456 7890", key);
    const parts = enc.split(":");
    const ct = Buffer.from(parts[3]!, "base64url");
    ct[0] = ct[0]! ^ 1;
    parts[3] = ct.toString("base64url");
    expect(() => decryptContact(parts.join(":"), key)).toThrow();
    expect(() => decryptContact(enc, randomBytes(32))).toThrow();
  });
});

describe("case codes and PINs", () => {
  it("generates well-formed, distinct case codes", () => {
    const codes = new Set(Array.from({ length: 2000 }, newCaseCode));
    expect(codes.size).toBe(2000);
    for (const c of codes) expect(c).toMatch(CASE_CODE_PATTERN);
  });

  it("normalises sloppy user input", () => {
    expect(normalizeCaseCode(" wb 7k3m-9qxp ")).toBe("WB-7K3M-9QXP");
    expect(normalizeCaseCode("7K3MOQXP")).toBe("WB-7K3M-0QXP");
  });

  it("PINs normalise regardless of dashes and case", () => {
    const pin = newPin();
    expect(pin).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    expect(normalizePin(pin.toLowerCase().replace("-", " "))).toBe(pin.replace("-", ""));
  });
});

describe("contact schema", () => {
  it("requires an email or a phone", () => {
    expect(contactSchema.safeParse({ email: "", phone: "" }).success).toBe(false);
    expect(contactSchema.safeParse({ email: "a@b.co" }).success).toBe(true);
    expect(contactSchema.safeParse({ phone: "+62 812-3456-7890" }).success).toBe(true);
    expect(contactSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
  });
});

describe("stream filters", () => {
  const run = (f: { push(t: string): string; flush(): string }, chunks: string[]) =>
    chunks.map((c) => f.push(c)).join("") + f.flush();

  it("strips think blocks split across chunks", () => {
    expect(run(new ThinkFilter(), ["Hel", "lo <thi", "nk>secret</th", "ink> world"])).toBe("Hello  world");
    expect(run(new ThinkFilter(), ["a < b"])).toBe("a < b");
  });

  it("strips the READY marker and records it", () => {
    const m = new MarkerStripper("[[READY]]");
    expect(run(m, ["Recap done.\n[[RE", "ADY]]"])).toBe("Recap done.\n");
    expect(m.found).toBe(true);
    const n = new MarkerStripper("[[READY]]");
    expect(run(n, ["array[[0]] ok"])).toBe("array[[0]] ok");
    expect(n.found).toBe(false);
  });
});

describe("AI draft parsing", () => {
  it("accepts fenced JSON and repairs small deviations", () => {
    const out = parseAssessment(`Here you go:\n\`\`\`json
{"draft":{"category":"bribery","title":"Kickbacks in procurement","summary":"Vendor pays manager.",
"details":{"what":"Kickbacks","who":null,"ongoing":"Yes"}},"completeness":"72.4","missing":["When?", ""]}
\`\`\``);
    expect(out.draft.category).toBeNull();
    expect(out.draft.details.who).toBe("");
    expect(out.draft.details.ongoing).toBe("yes");
    expect(out.draft.details.when).toBe("");
    expect(out.completeness).toBe(72);
    expect(out.missing).toEqual(["When?"]);
  });

  it("rejects non-JSON output", () => {
    expect(() => parseAssessment("I cannot help with that.")).toThrow();
  });
});

describe("completeness heuristic", () => {
  it("weights the key investigative fields", () => {
    const base = { what: "", who: "", when: "", where: "", howKnown: "", evidence: "", impact: "", ongoing: "unknown" as const };
    expect(estimateCompleteness(base)).toBe(0);
    expect(estimateCompleteness({ ...base, what: "Fraud", who: "Manager X", when: "May 2026" })).toBe(55);
  });
});

describe("logSafeError", () => {
  it("drops query parameters from drizzle errors", async () => {
    const { logSafeError } = await import("../src/lib/errors.js");
    const err = Object.assign(new Error("Failed query: insert ...\nparams: secret reporter text,me@x.com"), {
      cause: Object.assign(new Error("could not extend file: No space left on device"), { code: "53100" }),
    });
    const safe = logSafeError(err);
    expect(JSON.stringify(safe)).not.toContain("secret reporter text");
    expect(safe).toEqual({ message: "could not extend file: No space left on device", code: "53100" });
  });
});
