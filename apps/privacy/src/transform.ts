import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { fileTypeFromBuffer } from "file-type";
const run = promisify(execFile);
export type Rectangle = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};
async function raster(bytes: Buffer): Promise<Buffer[]> {
  const dir = await mkdtemp(join(tmpdir(), "wb-raster-"));
  try {
    const src = join(dir, "input.pdf");
    await writeFile(src, bytes);
    const info = await run("pdfinfo", [src], {
      timeout: 20000,
      maxBuffer: 65536,
    });
    const pages = Number(info.stdout.match(/Pages:\s+(\d+)/)?.[1]);
    if (!pages || pages > 50) throw new Error("page_limit");
    await run(
      "pdftoppm",
      ["-png", "-r", "100", "-scale-to", "1800", src, join(dir, "page")],
      { timeout: 60000, maxBuffer: 65536 },
    );
    const names = (await readdir(dir))
      .filter((n) => /^page-\d+\.png$/.test(n))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (names.length !== pages) throw new Error("conversion_incomplete");
    const images = [];
    let total = 0;
    for (const n of names) {
      const p = await readFile(join(dir, n));
      total += p.length;
      if (total > 50000000) throw new Error("size_limit");
      images.push(p);
    }
    return images;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
async function pdf(images: Buffer[]) {
  const doc = await PDFDocument.create();
  for (const bytes of images) {
    const img = await doc.embedPng(bytes),
      page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  doc.setTitle("Sanitized evidence");
  doc.setAuthor("");
  doc.setCreator("Speak Up");
  doc.setProducer("Speak Up");
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  return Buffer.from(await doc.save());
}
async function png(bytes: Buffer) {
  return sharp(bytes, {
    limitInputPixels: 20000000,
    animated: false,
    failOn: "warning",
  })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({
      width: 1800,
      height: 1800,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
}
export async function transform(bytes: Buffer) {
  const type = await fileTypeFromBuffer(bytes);
  if (!type) throw new Error("unsupported_type");
  if (["image/jpeg", "image/png", "image/webp"].includes(type.mime))
    return {
      bytes: await png(bytes),
      mime: "image/png",
      pages: 1,
      transformation: "decoded;metadata_removed;flattened",
    };
  let source = bytes;
  if (
    type.mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    type.mime ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    type.mime ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    const dir = await mkdtemp(join(tmpdir(), "wb-office-"));
    try {
      const input = join(dir, `input.${type.ext}`);
      await writeFile(input, bytes);
      await run(
        "libreoffice",
        [
          `-env:UserInstallation=file://${dir}/profile`,
          "--headless",
          "--convert-to",
          "pdf",
          "--outdir",
          dir,
          input,
        ],
        { timeout: 60000, maxBuffer: 65536 },
      );
      source = await readFile(join(dir, "input.pdf"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  } else if (type.mime !== "application/pdf")
    throw new Error("unsupported_type");
  const images = await raster(source);
  return {
    bytes: await pdf(images),
    mime: "application/pdf",
    pages: images.length,
    transformation: "rasterized;metadata_removed;active_content_removed",
  };
}
export async function redact(
  bytes: Buffer,
  mime: string,
  rectangles: Rectangle[],
) {
  const images = mime === "application/pdf" ? await raster(bytes) : [bytes];
  for (const r of rectangles)
    if (
      r.page > images.length ||
      r.x + r.width > 1.00001 ||
      r.y + r.height > 1.00001
    )
      throw new Error("invalid_rectangle");
  const result = [];
  for (let i = 0; i < images.length; i++) {
    const meta = await sharp(images[i]!).metadata();
    const w = meta.width!,
      h = meta.height!;
    const selected = rectangles.filter((r) => r.page === i + 1);
    const svg = `<svg width="${w}" height="${h}">${selected.map((r) => `<rect x="${Math.floor(r.x * w)}" y="${Math.floor(r.y * h)}" width="${Math.ceil(r.width * w)}" height="${Math.ceil(r.height * h)}" fill="black"/>`).join("")}</svg>`;
    result.push(
      await sharp(images[i]!)
        .composite([{ input: Buffer.from(svg) }])
        .png()
        .toBuffer(),
    );
  }
  return mime === "application/pdf" ? pdf(result) : result[0]!;
}
