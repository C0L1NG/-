// Isolated WeChat runtime simulation; no real accounts or network traffic.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../../..");
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function adminLogoutRace() {
  const storage = {
    admin_access_token: "old-token",
    admin_login_method: "wechat",
  };
  const pending = [];
  let renewals = 0;
  const wx = {
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => {
      storage[key] = value;
    },
    removeStorageSync: (key) => {
      delete storage[key];
    },
    reLaunch: () => {},
    login: ({ success }) => {
      renewals++;
      success({ code: "mock-code" });
    },
    request: (options) => pending.push(options),
  };
  const context = {
    module: { exports: {} },
    require: () => ({ API_BASE_URL: "https://test.invalid" }),
    wx,
    Promise,
  };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(root, "admin_miniprogram/services/api.js"),
      "utf8",
    ),
    context,
  );
  const api = context.module.exports;
  let page;
  vm.runInNewContext(
    fs.readFileSync(
      path.join(root, "admin_miniprogram/pages/dashboard/index.js"),
      "utf8",
    ),
    {
      Page: (value) => {
        page = value;
      },
      require: () => api,
      wx,
    },
  );
  const request = api.request("/api/admin/overview");
  page.logout();
  pending
    .find((item) => item.url.endsWith("/logout"))
    .success({ statusCode: 200, data: { ok: true } });
  await tick();
  const clearedAfterLogout = !storage.admin_access_token;
  pending
    .find((item) => item.url.endsWith("/overview"))
    .success({ statusCode: 401, data: { code: "UNAUTHORIZED" } });
  await tick();
  pending
    .find((item) => item.url.endsWith("/admin-login"))
    .success({
      statusCode: 200,
      data: { accessToken: "renewed-after-logout" },
    });
  await tick();
  pending
    .filter((item) => item.url.endsWith("/overview"))
    .at(-1)
    .success({ statusCode: 200, data: { platformTotalRevenue: "30.00" } });
  const result = await request;
  assert(
    clearedAfterLogout && storage.admin_access_token === "renewed-after-logout",
  );
  return {
    clearedAfterLogout,
    renewalsAfterLogout: renewals,
    tokenRestored: Boolean(storage.admin_access_token),
    protectedRequestSucceeded: result.platformTotalRevenue === "30.00",
  };
}
async function agentLogoutDuringRenewal() {
  const storage = { agent_access_token: "expired" };
  const app = { globalData: { authenticated: true } };
  const pending = [];
  const wx = {
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => {
      storage[key] = value;
    },
    removeStorageSync: (key) => {
      delete storage[key];
    },
    showToast: () => {},
    login: ({ success }) => success({ code: "mock-code" }),
    request: (options) => pending.push(options),
  };
  const context = {
    module: { exports: {} },
    require: () => ({ API_BASE_URL: "https://test.invalid" }),
    getApp: () => app,
    wx,
    Promise,
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(root, "miniprogram/services/api.js"), "utf8"),
    context,
  );
  const api = context.module.exports;
  let page;
  vm.runInNewContext(
    fs.readFileSync(
      path.join(root, "miniprogram/pages/profile/index.js"),
      "utf8",
    ),
    {
      Page: (value) => {
        page = value;
      },
      require: () => api,
      getApp: () => app,
      wx,
    },
  );
  page.setData = (patch) => Object.assign(page.data, patch);
  const request = api.request("/api/agent/overview");
  pending[0].success({ statusCode: 401, data: { code: "UNAUTHORIZED" } });
  await tick();
  page.logout();
  pending
    .find((item) => item.url.endsWith("/logout"))
    .success({ statusCode: 200, data: { ok: true } });
  await tick();
  const clearedAfterLogout = !storage.agent_access_token;
  pending
    .find((item) => item.url.endsWith("/login"))
    .success({
      statusCode: 200,
      data: { accessToken: "renewed-after-logout" },
    });
  await tick();
  pending
    .filter((item) => item.url.endsWith("/overview"))
    .at(-1)
    .success({ statusCode: 200, data: { balance: "70.00" } });
  const result = await request;
  assert(
    clearedAfterLogout && storage.agent_access_token === "renewed-after-logout",
  );
  return {
    clearedAfterLogout,
    uiLoggedOut: page.data.loggedOut,
    authenticatedFlag: app.globalData.authenticated,
    tokenRestored: Boolean(storage.agent_access_token),
    protectedRequestSucceeded: result.balance === "70.00",
  };
}
(async () => {
  const evidence = {
    adminLogoutRace: await adminLogoutRace(),
    agentLogoutDuringRenewal: await agentLogoutDuringRenewal(),
  };
  fs.writeFileSync(
    path.join(root, "docs/reviews/review2-native-evidence.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
