import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { transform, redact } from "../src/transform.js";
import {
  seal,
  unseal,
  parseKeyring,
  capability,
  verifyCapability,
  safeError,
} from "@whistle/runtime";
import { randomBytes, generateKeyPairSync } from "node:crypto";
describe("evidence and encryption boundaries", () => {
  it("removes metadata and irreversibly covers image pixels", async () => {
    const original = await sharp({
      create: { width: 100, height: 100, channels: 3, background: "white" },
    })
      .withExif({ IFD0: { Artist: "private-reporter@example.test" } })
      .jpeg()
      .toBuffer();
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const converted = await transform(original);
    expect(converted.mime).toBe("image/png");
    expect((await sharp(converted.bytes).metadata()).exif).toBeUndefined();
    expect(converted.bytes.includes(Buffer.from("private-reporter"))).toBe(
      false,
    );
    const redacted = await redact(converted.bytes, converted.mime, [
      { page: 1, x: 0, y: 0, width: 0.5, height: 0.5 },
    ]);
    const { data, info } = await sharp(redacted)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)]).toEqual([0, 0, 0]);
    expect([
      ...data.subarray(
        (99 * info.width + 99) * info.channels,
        (99 * info.width + 99) * info.channels + 3,
      ),
    ]).toEqual([255, 255, 255]);
  });
  it("fails closed for unsupported and malformed input", async () => {
    await expect(
      transform(Buffer.from("an executable, not an image")),
    ).rejects.toThrow();
    const png = await sharp({
      create: { width: 10, height: 10, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    await expect(
      redact(png, "image/png", [{ page: 2, x: 0, y: 0, width: 1, height: 1 }]),
    ).rejects.toThrow();
    await expect(
      redact(png, "image/png", [
        { page: 1, x: 0.9, y: 0, width: 0.2, height: 0.5 },
      ]),
    ).rejects.toThrow();
  });
  it("binds ciphertext to purpose and supports key rotation without disclosure", () => {
    const old = {
      active: "old",
      keys: { old: randomBytes(32).toString("base64") },
    };
    const encrypted = seal("secret identity", old, "contact:one");
    const rotated = parseKeyring(
      JSON.stringify({
        active: "new",
        keys: { ...old.keys, new: randomBytes(32).toString("base64") },
      }),
    );
    expect(unseal(encrypted, rotated, "contact:one")).toBe("secret identity");
    expect(() => unseal(encrypted, rotated, "case:one")).toThrow();
    const parts = encrypted.split(":");
    parts[4] = (parts[4]![0] === "A" ? "B" : "A") + parts[4]!.slice(1);
    expect(() => unseal(parts.join(":"), rotated, "contact:one")).toThrow();
    expect(encrypted).not.toContain("secret identity");
  });
  it("verifies signed case capabilities and excludes sensitive error text", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const priv = privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      pub = publicKey.export({ type: "spki", format: "pem" }).toString();
    const encoded = capability(
      {
        sub: "12345678-1234-1234-1234-123456789000",
        sid: "12345678-1234-1234-1234-123456789001",
        version: 1,
        purpose: "reporter",
      },
      priv,
    );
    expect(verifyCapability(encoded, pub).version).toBe(1);
    expect(() => verifyCapability(encoded + "forged", pub)).toThrow();
    expect(safeError(new Error("reporter@example.test token=123456"))).toEqual({
      name: "Error",
      code: undefined,
    });
  });
});
