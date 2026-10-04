import { readdir, mkdir, copyFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function materialize(relative = "") {
  const entries = await readdir(
    path.join(root, "showcase-template", relative),
    { withFileTypes: true },
  );
  for (const item of entries) {
    const name = path.join(relative, item.name);
    if (item.isDirectory()) {
      await materialize(name);
      continue;
    }
    const target = path.join(root, "showcase-site", name);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await access(target);
    } catch {
      await copyFile(path.join(root, "showcase-template", name), target);
    }
  }
}
await materialize();
const result = spawnSync(
  process.execPath,
  [path.join(root, "scripts/sync-showcase.mjs")],
  { stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
