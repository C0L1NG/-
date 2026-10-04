import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  copyFile,
  readFile,
  rm,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "commission-sync-"));
  await mkdir(path.join(root, "scripts"));
  await copyFile(
    new URL("../sync-showcase.mjs", import.meta.url),
    path.join(root, "scripts/sync-showcase.mjs"),
  );
  for (const base of ["web", "showcase-site"]) {
    for (const dir of ["components", "lib", "app/agent"])
      await mkdir(path.join(root, base, dir), { recursive: true });
    for (const file of ["app/globals.css", "app/agent/agent-theme.css"])
      await writeFile(path.join(root, base, file), "css");
  }
  return root;
}
function run(root, check = false) {
  return spawnSync(
    process.execPath,
    [
      path.join(root, "scripts/sync-showcase.mjs"),
      ...(check ? ["--check"] : []),
    ],
    { encoding: "utf8" },
  );
}

test("sync creates nested folders, handles assets, and checks removed source files", async () => {
  const root = await fixture();
  try {
    await mkdir(path.join(root, "web/components/new-feature"));
    await writeFile(
      path.join(root, "web/components/new-feature/example.tsx"),
      "component",
    );
    await writeFile(
      path.join(root, "web/components/new-feature/icon.svg"),
      "<svg/>",
    );
    await writeFile(path.join(root, "web/lib/options.json"), "{}");
    assert.equal(run(root).status, 0);
    assert.equal(
      await readFile(
        path.join(root, "showcase-site/components/new-feature/example.tsx"),
        "utf8",
      ),
      "component",
    );
    assert.equal(run(root, true).status, 0);
    await writeFile(
      path.join(root, "showcase-site/components/orphan.tsx"),
      "orphan",
    );
    const result = run(root, true);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /removed source/);
    assert.equal(run(root).status, 0);
    assert.equal(run(root, true).status, 0);
    // Site-specific app routes are outside the mirrored roots.
    await writeFile(path.join(root, "showcase-site/app/page.tsx"), "site page");
    run(root);
    assert.equal(
      await readFile(path.join(root, "showcase-site/app/page.tsx"), "utf8"),
      "site page",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
