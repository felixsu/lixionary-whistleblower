import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkVersion, setVersion } from "../version.mjs";

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "whistle-version-"));
  try {
    for (const path of ["apps/web", "packages/shared"])
      await mkdir(join(root, path), { recursive: true });
    for (const path of [
      "package.json",
      "apps/web/package.json",
      "packages/shared/package.json",
    ]) {
      await writeFile(
        join(root, path),
        JSON.stringify(
          {
            name: path,
            version: "0.2.0",
            private: true,
            scripts: { build: "echo build" },
          },
          null,
          2,
        ) + "\n",
      );
    }
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

for (const [change, expected] of [
  ["patch", "0.2.1"],
  ["minor", "0.3.0"],
  ["major", "1.0.0"],
  ["1.2.3", "1.2.3"],
]) {
  test(`${change} updates the whole workspace and preserves package metadata`, () =>
    fixture(async (root) => {
      assert.equal(await setVersion(change, root), expected);
      assert.equal(await checkVersion(root), expected);
      const web = JSON.parse(
        await readFile(join(root, "apps/web/package.json"), "utf8"),
      );
      assert.equal(web.private, true);
      assert.equal(web.scripts.build, "echo build");
    }));
}

test("version drift fails validation and sync uses the root as the authority", () =>
  fixture(async (root) => {
    await writeFile(
      join(root, "apps/web/package.json"),
      JSON.stringify({ version: "0.1.0" }),
    );
    await assert.rejects(
      checkVersion(root),
      /apps\/web\/package.json \(0.1.0\)/,
    );
    await setVersion("sync", root);
    assert.equal(await checkVersion(root), "0.2.0");
  }));

test("invalid, equal and older versions are rejected without modifying files", () =>
  fixture(async (root) => {
    const before = await readFile(join(root, "package.json"), "utf8");
    for (const value of [
      "banana",
      "01.2.3",
      "v1.0.0",
      "1.0",
      "0.1.9",
      "0.2.0",
    ]) {
      await assert.rejects(setVersion(value, root));
      assert.equal(await readFile(join(root, "package.json"), "utf8"), before);
    }
  }));

test("a malformed root version prevents synchronization", () =>
  fixture(async (root) => {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ version: "01.2.0" }),
    );
    await assert.rejects(checkVersion(root), /Root version/);
    await assert.rejects(setVersion("sync", root), /Root version/);
  }));
