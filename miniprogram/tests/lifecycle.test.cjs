const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const base = path.resolve(__dirname, "..");
const tick = () => new Promise((resolve) => setImmediate(resolve));

function appWith(api) {
  let app;
  vm.runInNewContext(fs.readFileSync(path.join(base, "app.js"), "utf8"), {
    require: () => api,
    App(value) {
      app = value;
    },
    wx: { showToast() {} },
    decodeURIComponent,
    Promise,
  });
  return app;
}

test("ready includes server login/binding; warm scan queues and retains referral", async () => {
  const calls = [],
    releases = [];
  const app = appWith({
    login(ref) {
      calls.push(ref);
      return new Promise((resolve) => releases.push(resolve));
    },
  });
  app.onLaunch({ query: { scene: "r=ROOT" } });
  app.onShow({ query: { scene: "r=ROOT" } });
  await tick();
  assert.deepEqual(calls, ["ROOT"]);
  let ready = false;
  app.ready.then(() => {
    ready = true;
  });
  await tick();
  assert.equal(ready, false);
  app.onShow({ query: { ref: "NEWROOT" } });
  releases[0]({ agent: { parentId: "parent" } });
  await tick();
  assert.deepEqual(calls, ["ROOT", "NEWROOT"]);
  releases[1]({ agent: { parentId: "other-parent" } });
  await app.ready;
  assert.equal(app.globalData.authenticated, true);
});

test("token expiration renews concurrent requests only once", async () => {
  const storage = {},
    calls = [];
  let logins = 0;
  const context = {
    module: { exports: {} },
    require() {
      return { API_BASE_URL: "https://test" };
    },
    wx: {
      getStorageSync(key) {
        return storage[key];
      },
      setStorageSync(key, value) {
        storage[key] = value;
      },
      removeStorageSync(key) {
        delete storage[key];
      },
      login({ success }) {
        logins++;
        setImmediate(() => success({ code: "wx-code" }));
      },
      request(opts) {
        calls.push(opts.url);
        setImmediate(() =>
          opts.success(
            opts.url.endsWith("/login")
              ? { statusCode: 200, data: { accessToken: "new-token" } }
              : {
                  statusCode: storage.agent_access_token ? 200 : 401,
                  data: { ok: true },
                },
          ),
        );
      },
    },
    Promise,
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(base, "services/api.js"), "utf8"),
    context,
  );
  const api = context.module.exports;
  await Promise.all([
    api.request("/api/agent/overview"),
    api.request("/api/agent/team"),
  ]);
  assert.equal(logins, 1);
  assert.equal(storage.agent_access_token, "new-token");
  assert.equal(calls.filter((x) => x.endsWith("/login")).length, 1);
});

test("team and ledger retain the 101st record through pagination", async () => {
  const requests = [];
  const fake = {
    request(url) {
      requests.push(url);
      const page = Number(
        new URL(url, "https://test").searchParams.get("page"),
      );
      const start = (page - 1) * 50;
      return Promise.resolve({
        items: Array.from({ length: Math.min(50, 101 - start) }, (_, i) => ({
          id: String(start + i),
        })),
        page,
        total: 101,
        totalPages: 3,
      });
    },
  };
  let pager;
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(base, "services/pager.js"), "utf8"),
    { require: () => fake, module, Set, Promise },
  );
  pager = module.exports;
  for (const resource of ["team", "ledger"]) {
    let page;
    vm.runInNewContext(
      fs.readFileSync(path.join(base, `pages/${resource}/index.js`), "utf8"),
      {
        require: () => pager,
        Page(value) {
          page = value;
        },
        getApp: () => ({ ready: Promise.resolve() }),
        wx: { stopPullDownRefresh() {} },
        Date,
        Promise,
      },
    );
    page.setData = (values) => Object.assign(page.data, values);
    page.data.month = "2026-10";
    await page.reload();
    await page.loadMore();
    await page.loadMore();
    assert.equal(page.data.items.length, 101);
    assert.equal(page.data.page, 3);
  }
  assert.equal(requests.length, 6);
});

test("old filter response cannot overwrite a refreshed list", async () => {
  const releases = [];
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(base, "services/pager.js"), "utf8"),
    {
      require: () => ({
        request: () => new Promise((resolve) => releases.push(resolve)),
      }),
      module,
      Set,
      Promise,
    },
  );
  const { reset, pageLoader } = module.exports;
  const page = {
    data: { items: [], page: 0, totalPages: 1, loading: false },
    setData(values) {
      Object.assign(this.data, values);
    },
  };
  const old = pageLoader(page, () => "/old");
  reset(page);
  const current = pageLoader(page, () => "/current");
  releases[1]({ items: [{ id: "current" }], page: 1, totalPages: 1, total: 1 });
  await current;
  releases[0]({ items: [{ id: "old" }], page: 1, totalPages: 1, total: 1 });
  await old;
  assert.equal(page.data.items.map((x) => x.id).join(","), "current");
});

test("the four tabs and all referenced page files exist", () => {
  const app = JSON.parse(fs.readFileSync(path.join(base, "app.json"), "utf8"));
  assert.deepEqual(
    app.tabBar.list.map((x) => x.text),
    ["首页", "进展", "明细", "我的"],
  );
  for (const page of app.pages)
    for (const ext of ["js", "json", "wxml", "wxss"])
      assert.ok(fs.existsSync(path.join(base, `${page}.${ext}`)));
});

test("both native projects have parseable JavaScript and complete page files", () => {
  for (const folder of [base, path.resolve(base, "../admin_miniprogram")]) {
    const app = JSON.parse(
      fs.readFileSync(path.join(folder, "app.json"), "utf8"),
    );
    for (const page of app.pages)
      for (const ext of ["js", "json", "wxml", "wxss"])
        assert.ok(
          fs.existsSync(path.join(folder, `${page}.${ext}`)),
          `${page}.${ext}`,
        );
    function check(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) check(file);
        else if (file.endsWith(".js"))
          new vm.Script(fs.readFileSync(file, "utf8"), { filename: file });
      }
    }
    check(folder);
  }
});
