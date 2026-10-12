import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

async function manifests(root) {
  const paths = ["package.json"];
  for (const group of ["apps", "packages"]) {
    for (const entry of await readdir(resolve(root, group), {
      withFileTypes: true,
    })) {
      if (entry.isDirectory())
        paths.push(`${group}/${entry.name}/package.json`);
    }
  }
  return Promise.all(
    paths.map(async (path) => {
      const content = await readFile(resolve(root, path), "utf8");
      return { path, content, data: JSON.parse(content) };
    }),
  );
}

export async function checkVersion(root = projectRoot) {
  const files = await manifests(root);
  const version = files[0].data.version;
  if (!semver.test(version))
    throw new Error(
      "Root version must be MAJOR.MINOR.PATCH without leading zeros.",
    );
  const mismatches = files.filter((file) => file.data.version !== version);
  if (mismatches.length) {
    throw new Error(
      `Version ${version} is out of sync: ${mismatches.map((file) => `${file.path} (${file.data.version})`).join(", ")}. Run pnpm version:sync.`,
    );
  }
  return version;
}

export async function setVersion(change, root = projectRoot) {
  const files = await manifests(root);
  const current = files[0].data.version;
  if (!semver.test(current))
    throw new Error(
      "Root version must be MAJOR.MINOR.PATCH without leading zeros.",
    );
  let next = current;
  if (change !== "sync") {
    if (!semver.test(change) && !["patch", "minor", "major"].includes(change)) {
      throw new Error(
        "Use patch, minor, major, sync, or an explicit MAJOR.MINOR.PATCH version.",
      );
    }
    if (semver.test(change)) next = change;
    else {
      const parts = current.split(".").map(BigInt);
      const index = { major: 0, minor: 1, patch: 2 }[change];
      parts[index] += 1n;
      for (let i = index + 1; i < parts.length; i++) parts[i] = 0n;
      next = parts.join(".");
    }
    // Prevent an accidental release rollback or a bump that does nothing.
    const oldParts = current.split(".").map(BigInt);
    const nextParts = next.split(".").map(BigInt);
    const difference = nextParts.findIndex(
      (part, index) => part !== oldParts[index],
    );
    if (difference === -1 || nextParts[difference] < oldParts[difference]) {
      throw new Error(
        "The new version must be greater than the current version.",
      );
    }
  }
  for (const file of files) {
    if (file.data.version === next) continue;
    file.data.version = next;
    await writeFile(
      resolve(root, file.path),
      JSON.stringify(file.data, null, 2) + "\n",
    );
  }
  return next;
}

export async function main(args = process.argv.slice(2)) {
  const [command, ...extra] = args.filter((arg) => arg !== "--");
  if (!command || extra.length)
    throw new Error(
      "Usage: pnpm version:bump patch|minor|major|MAJOR.MINOR.PATCH; pnpm version:check; pnpm version:sync",
    );
  const version =
    command === "check" ? await checkVersion() : await setVersion(command);
  console.log(`Project version: ${version}`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
