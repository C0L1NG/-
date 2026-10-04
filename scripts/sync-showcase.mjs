// The deployable static site keeps a generated copy of the production UI.
// Page/layout files remain separate because the site forces demo mode.
import { readFile, readdir, copyFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const source = path.join(root, "web");
const target = path.join(root, "showcase-site");
const shared = [
  "components",
  "lib",
  "app/globals.css",
  "app/agent/agent-theme.css",
];
const excluded = new Set([
  "lib/proxy.ts",
  "lib/auth-proxy.ts",
  "lib/request-origin.ts",
]);

async function files(base, relative) {
  let entries;
  try {
    entries = await readdir(path.join(base, relative), { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOTDIR")
      return excluded.has(relative) ? [] : [relative];
    if (error.code === "ENOENT" && base === target) return [];
    throw error;
  }
  return (
    await Promise.all(
      entries
        .filter((entry) => !entry.name.startsWith("."))
        .map((entry) => {
          if (entry.isSymbolicLink())
            throw new Error("Shared UI must not contain symlinks");
          return files(base, path.join(relative, entry.name));
        }),
    )
  ).flat();
}

const paths = (
  await Promise.all(shared.map((item) => files(source, item)))
).flat();
const targetPaths = (
  await Promise.all(shared.map((item) => files(target, item)))
).flat();
const stale = [];
for (const relative of paths) {
  const from = path.join(source, relative);
  const to = path.join(target, relative);
  const expected = await readFile(from);
  const actual = await readFile(to).catch(() => null);
  if (actual?.equals(expected)) continue;
  if (check) stale.push(relative);
  else {
    await mkdir(path.dirname(to), { recursive: true });
    await copyFile(from, to);
  }
}
for (const relative of targetPaths.filter((item) => !paths.includes(item))) {
  if (check) stale.push("removed source: " + relative);
  else await rm(path.join(target, relative));
}
if (stale.length) {
  console.error(
    `Showcase UI is stale:\n${stale.map((item) => `  ${item}`).join("\n")}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    check
      ? `Showcase UI matches web (${paths.length} shared files)`
      : `Synced ${paths.length} shared UI files to showcase-site`,
  );
}
