import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(
  process.execPath,
  [path.join(root, "node_modules/prisma/build/index.js"), "generate"],
  {
    cwd: root,
    stdio: "inherit",
    // Generation does not connect. Deployment still requires an explicit DATABASE_URL.
    env: {
      ...process.env,
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://generate:generate@localhost:5432/generate_only",
    },
  },
);
process.exitCode = result.status ?? 1;
