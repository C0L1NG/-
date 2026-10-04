const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const base = path.resolve(__dirname, "..");

function loadModule(storage) {
  const context = {
    module: { exports: {} },
    wx: {
      getStorageSync: (key) => storage[key],
      setStorageSync: (key, value) => (storage[key] = value),
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(base, "services/privacy.js"), "utf8"),
    context,
  );
  return context.module.exports;
}

test("native privacy survives tab changes and app restart; can be revealed again", () => {
  const storage = {};
  const page = () => ({
    data: {},
    setData(value) {
      Object.assign(this.data, value);
    },
  });
  const home = page(),
    ledger = page();
  const privacy = loadModule(storage);
  privacy.syncPrivacy(home);
  assert.equal(home.data.hidden, false);
  privacy.togglePrivacy(home);
  loadModule(storage).syncPrivacy(ledger);
  assert.equal(ledger.data.hidden, true);
  privacy.togglePrivacy(home);
  privacy.syncPrivacy(ledger);
  assert.equal(ledger.data.hidden, false);
});

test("returning to every native financial page reloads the shared privacy setting", async () => {
  for (const name of ["home", "progress", "ledger", "team", "withdrawals"]) {
    let page,
      syncs = 0;
    vm.runInNewContext(
      fs.readFileSync(path.join(base, `pages/${name}/index.js`), "utf8"),
      {
        require: (id) =>
          id.endsWith("privacy") ? { syncPrivacy: () => syncs++ } : {},
        Page: (value) => (page = value),
        getApp: () => ({ ready: Promise.resolve() }),
      },
    );
    page.load = page.reload = () => Promise.resolve();
    await page.onShow();
    assert.equal(syncs, 1, name);
  }
});
