import Fastify from "fastify";
import { transform } from "./transform.js";
const app = Fastify({ bodyLimit: 20 * 1024 * 1024, logger: false });
app.addContentTypeParser(
  "application/octet-stream",
  { parseAs: "buffer" },
  (_req, body, done) => done(null, body),
);
app.get("/health", async () => ({ ok: true }));
app.post("/convert", async (req, reply) => {
  try {
    const result = await transform(req.body as Buffer);
    return {
      data: result.bytes.toString("base64"),
      mime: result.mime,
      pages: result.pages,
      transformation: result.transformation,
    };
  } catch {
    return reply.status(422).send({ error: "conversion_failed" });
  }
});
await app.listen({ host: "0.0.0.0", port: 6406 });
