import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("Google setup creates protected placeholders, preserves existing values, and exposes credentials only to the staff API", async () => {
  const root = await mkdtemp(join(tmpdir(), "wb-google-config-"));
  try {
    const setup = () =>
      spawnSync(process.execPath, ["scripts/setup-suite.mjs"], {
        encoding: "utf8",
        env: { ...process.env, SUITE_CONFIG_DIR: root },
      });
    let result = setup();
    assert.equal(result.status, 0, result.stderr);
    const secret = join(root, "secrets/staff_google_client_secret");
    assert.equal(await readFile(secret, "utf8"), "");
    assert.equal((await stat(secret)).mode & 0o777, 0o600);
    assert.equal((await stat(join(root, "secrets"))).mode & 0o777, 0o700);
    const envFile = join(root, "suite.env");
    const original = await readFile(envFile, "utf8");
    assert.match(original, /STAFF_GOOGLE_CLIENT_ID=\n/);
    await writeFile(secret, "synthetic-client-secret\n");
    await writeFile(
      envFile,
      original.replace(
        "STAFF_GOOGLE_CLIENT_ID=\n",
        "STAFF_GOOGLE_CLIENT_ID=synthetic-client\n",
      ),
    );
    result = setup();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(secret, "utf8"), "synthetic-client-secret\n");
    assert.match(
      await readFile(envFile, "utf8"),
      /STAFF_GOOGLE_CLIENT_ID=synthetic-client\n/,
    );
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /synthetic-client-secret/,
    );
    const compose = spawnSync(
      "docker",
      ["compose", "--env-file", envFile, "config", "--format", "json"],
      { encoding: "utf8" },
    );
    assert.equal(compose.status, 0, compose.stderr);
    const config = JSON.parse(compose.stdout);
    assert.equal(
      config.services["case-api"].environment.STAFF_GOOGLE_CLIENT_ID,
      "synthetic-client",
    );
    assert.equal(
      config.services["case-api"].environment.STAFF_GOOGLE_CLIENT_SECRET_FILE,
      "/run/secrets/staff_google_client_secret",
    );
    for (const [name, service] of Object.entries(config.services)) {
      const hasGoogleSecret = service.secrets?.some(
        (s) => s.source === "staff_google_client_secret",
      );
      assert.equal(!!hasGoogleSecret, name === "case-api");
      assert.equal(service.environment?.STAFF_GOOGLE_CLIENT_SECRET, undefined);
    }
    assert.doesNotMatch(compose.stdout, /synthetic-client-secret/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
