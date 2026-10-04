const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const tick = () => new Promise((resolve) => setImmediate(resolve));

function client(role) {
  const storage = {
    [`${role}_access_token`]: "old",
    admin_login_method: "wechat",
  };
  const pending = [];
  const app = { globalData: { authenticated: true } };
  const context = {
    module: { exports: {} },
    require: () => ({ API_BASE_URL: "https://test" }),
    getApp: () => app,
    Promise,
    wx: {
      getStorageSync: (key) => storage[key],
      setStorageSync: (key, value) => {
        storage[key] = value;
      },
      removeStorageSync: (key) => {
        delete storage[key];
      },
      login: ({ success }) => success({ code: "wx-code" }),
      reLaunch() {},
      request: (options) => pending.push(options),
    },
  };
  const folder = role === "agent" ? "miniprogram" : "admin_miniprogram";
  vm.runInNewContext(
    fs.readFileSync(
      path.resolve(__dirname, `../../${folder}/services/api.js`),
      "utf8",
    ),
    context,
  );
  const api = context.module.exports;
  function finish(suffix, data = {}, statusCode = 200) {
    const index = pending.findIndex((item) => item.url.endsWith(suffix));
    assert.ok(index >= 0, `Missing request: ${suffix}`);
    pending.splice(index, 1)[0].success({ statusCode, data });
  }
  return { api, storage, pending, finish, app };
}
for (const role of ["agent", "admin"]) {
  test(`${role}: logout blocks a late renewal token and request replay`, async () => {
    const { api, storage, pending, finish } = client(role);
    const outcome = api.request(`/api/${role}/overview`).then(
      () => "resolved",
      (e) => e.code || e.statusCode,
    );
    finish("/overview", {}, 401);
    await tick();
    assert.ok(pending.some((item) => item.url.includes("login")));
    const logout = api.logout();
    finish("/logout");
    await logout;
    finish(role === "agent" ? "/login" : "/admin-login", {
      accessToken: "late",
    });
    assert.equal(await outcome, "SESSION_CANCELLED");
    assert.equal(storage[`${role}_access_token`], undefined);
    if (role === "admin") assert.equal(storage.admin_login_method, undefined);
    assert.equal(pending.length, 0);
    await assert.rejects(api.request(`/api/${role}/overview`), {
      code: "SESSION_CANCELLED",
    });
  });
  test(`${role}: a 401 arriving after logout cannot start renewal`, async () => {
    const { api, pending, finish } = client(role);
    const outcome = api
      .request(`/api/${role}/overview`)
      .catch((e) => e.statusCode);
    const logout = api.logout();
    finish("/logout");
    await logout;
    finish("/overview", {}, 401);
    assert.equal(await outcome, 401);
    assert.equal(pending.length, 0);
  });
  test(`${role}: failed server logout still clears locally; explicit login is allowed`, async () => {
    const { api, storage, finish } = client(role);
    const logout = api.logout().catch((e) => e.statusCode);
    finish("/logout", {}, 503);
    assert.equal(await logout, 503);
    assert.equal(storage[`${role}_access_token`], undefined);
    const login = api.login();
    await tick();
    finish(role === "agent" ? "/login" : "/admin-login", {
      accessToken: "fresh",
    });
    await login;
    assert.equal(storage[`${role}_access_token`], "fresh");
  });
  test(`${role}: old explicit login cannot overwrite a new session`, async () => {
    const { api, storage, pending, finish } = client(role);
    const old = api.login().catch((e) => e.code);
    await tick();
    const oldRequest = pending.shift();
    const logout = api.logout();
    finish("/logout");
    await logout;
    const fresh = api.login();
    await tick();
    finish(role === "agent" ? "/login" : "/admin-login", {
      accessToken: "fresh",
    });
    await fresh;
    oldRequest.success({ statusCode: 200, data: { accessToken: "late-old" } });
    assert.equal(await old, "SESSION_CANCELLED");
    assert.equal(storage[`${role}_access_token`], "fresh");
  });
}

for (const role of ["agent", "admin"]) {
  test(`${role}: a late wx.login callback after logout cannot send a new login`, async () => {
    const storage = { [`${role}_access_token`]: "old" },
      pending = [];
    let completeWx;
    const context = {
      module: { exports: {} },
      require: () => ({ API_BASE_URL: "https://test" }),
      Promise,
      wx: {
        getStorageSync: (key) => storage[key],
        setStorageSync: (key, value) => {
          storage[key] = value;
        },
        removeStorageSync: (key) => {
          delete storage[key];
        },
        login: ({ success }) => {
          completeWx = success;
        },
        request: (item) => pending.push(item),
      },
    };
    const folder = role === "agent" ? "miniprogram" : "admin_miniprogram";
    vm.runInNewContext(
      fs.readFileSync(
        path.resolve(__dirname, `../../${folder}/services/api.js`),
        "utf8",
      ),
      context,
    );
    const api = context.module.exports;
    const login = api.login().catch((e) => e.code);
    await tick();
    const logout = api.logout();
    pending.shift().success({ statusCode: 200, data: { ok: true } });
    await logout;
    completeWx({ code: "late-code" });
    assert.equal(await login, "SESSION_CANCELLED");
    assert.equal(pending.length, 0);
  });
}
