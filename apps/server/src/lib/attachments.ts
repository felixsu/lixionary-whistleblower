import { createHash } from "node:crypto";
import { basename } from "node:path";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { ALLOWED_ATTACHMENT_TYPES } from "@whistle/shared";
import { badRequest } from "./errors.js";

export interface ProcessedFile {
  data: Buffer;
  mime: string;
  originalName: string;
  sha256: string;
}

const IMAGE_FORMATS: Record<string, "png" | "jpeg" | "webp"> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
};

export function sanitizeFilename(name: string): string {
  const clean = basename(name.replace(/\\/g, "/"))
    .replace(/[\u0000-\u001f\u007f"<>|]/g, "")
    .trim()
    .slice(0, 200);
  return clean || "file";
}

function looksLikeText(data: Buffer): boolean {
  if (data.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(data);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates an upload by its content (not the client-supplied type) and strips
 * image metadata (EXIF, GPS, camera serials) that could identify the reporter.
 */
export async function processUpload(data: Buffer, filename: string): Promise<ProcessedFile> {
  if (data.length === 0) throw badRequest("The file is empty");
  const detected = await fileTypeFromBuffer(data);
  let mime = detected?.mime as string | undefined;
  if (!mime && /\.(txt|csv|log|md)$/i.test(filename) && looksLikeText(data)) mime = "text/plain";
  if (!mime || !(mime in ALLOWED_ATTACHMENT_TYPES)) {
    throw badRequest(
      `This file type isn't accepted. Allowed: ${Object.values(ALLOWED_ATTACHMENT_TYPES).join(", ")}.`,
      "unsupported_type",
    );
  }

  let out = data;
  const imageFormat = IMAGE_FORMATS[mime];
  if (imageFormat) {
    try {
      // sharp drops all metadata unless .withMetadata() is called; rotate() bakes in EXIF orientation first.
      out = await sharp(data, { failOn: "error" }).rotate().toFormat(imageFormat).toBuffer();
    } catch {
      throw badRequest("The image could not be read", "invalid_image");
    }
  }

  return {
    data: out,
    mime,
    originalName: sanitizeFilename(filename),
    sha256: createHash("sha256").update(out).digest("hex"),
  };
}
