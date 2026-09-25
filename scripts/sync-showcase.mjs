// The deployable static site keeps a generated copy of the production UI.
// Page/layout files remain separate because the site forces demo mode.
import { readFile, readdir, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const source = path.join(root, "web");
const target = path.join(root, "showcase-site");
const shared = ["components", "lib", "app/globals.css", "app/agent/agent-theme.css"];
const excluded = new Set(["lib/proxy.ts"]);

async function files(relative) {
  const full = path.join(source, relative);
  if (!relative.endsWith(".css") && !relative.endsWith(".ts") && !relative.endsWith(".tsx")) {
    const entries = await readdir(full, { withFileTypes: true });
    const nested = await Promise.all(entries.map((entry) => files(path.join(relative, entry.name))));
    return nested.flat();
  }
  return excluded.has(relative) ? [] : [relative];
}

const paths = (await Promise.all(shared.map(files))).flat();
const stale = [];
for (const relative of paths) {
  const from = path.join(source, relative);
  const to = path.join(target, relative);
  const expected = await readFile(from);
  const actual = await readFile(to).catch(() => null);
  if (actual?.equals(expected)) continue;
  if (check) stale.push(relative);
  else await copyFile(from, to);
}
if (stale.length) {
  console.error(`Showcase UI is stale:\n${stale.map((item) => `  ${item}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(check ? `Showcase UI matches web (${paths.length} shared files)` :
    `Synced ${paths.length} shared UI files to showcase-site`);
}
