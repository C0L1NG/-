const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function mount(request, storage = new Map(), ready = Promise.resolve()) {
  let definition;
  vm.runInNewContext(
    fs.readFileSync("miniprogram/pages/withdrawals/index.js", "utf8"),
    {
      require: (name) =>
        name.includes("privacy") ? { syncPrivacy() {} } : { request },
      Page: (page) => {
        definition = page;
      },
      getApp: () => ({ ready }),
      wx: {
        getStorageSync: (key) =>
          key === "agent_user_id"
            ? storage.get(key) || "qa-user"
            : storage.get(key),
        setStorageSync: (key, value) => storage.set(key, value),
        removeStorageSync: (key) => storage.delete(key),
        showToast() {},
      },
    },
  );
  return {
    ...definition,
    storageKey: "agent_withdrawal_intent:qa-user",
    data: { ...definition.data, total: 45 },
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
}
const tick = () => new Promise(setImmediate);

test("withdrawal paging ignores reversed responses and hidden-page results", async () => {
  const pending = [];
  const page = mount(
    (path) => new Promise((resolve) => pending.push({ path, resolve })),
  );
  const first = page.load();
  page.next();
  function resolve(offset, id) {
    for (const item of pending.slice(offset, offset + 3))
      item.resolve(
        item.path.includes("/wallet")
          ? { balance: id }
          : { items: [{ id, verified: true }], total: 45 },
      );
  }
  resolve(3, "page-2");
  await tick();
  resolve(0, "page-1");
  await first;
  assert.equal(page.data.page, 2);
  assert.equal(page.data.items[0].id, "page-2");
  assert.equal(page.data.wallet.balance, "page-2");
  const hidden = page.load();
  page.onHide();
  resolve(6, "hidden");
  await hidden;
  assert.equal(page.data.items[0].id, "page-2");
});

test("unknown withdrawal survives reload, locks its payload and looks up instead of duplicating", async () => {
  const storage = new Map();
  const accepted = new Map();
  let posts = 0;
  const request = async (path, options = {}) => {
    if (options.method === "POST") {
      posts++;
      accepted.set(options.data.idempotencyKey, {
        id: "accepted",
        amount: options.data.amount,
      });
      throw new Error("response lost");
    }
    if (path.includes("withdrawal-intents"))
      return accepted.get(path.split("/").at(-1));
    return path.includes("wallet")
      ? { balance: "100.00", debtBalance: "0.00" }
      : { items: [], total: 0 };
  };
  const first = mount(request, storage);
  first.data.amount = "10.00";
  first.data.accountId = "own-account";
  await first.submit();
  assert.equal(first.data.recovering, true);
  first.onAmount({ detail: { value: "20.00" } });
  assert.equal(first.data.amount, "10.00");
  const resumed = mount(request, storage);
  resumed.onShow();
  await tick();
  assert.equal(resumed.data.amount, "10.00");
  await resumed.submit();
  assert.equal(posts, 1);
  assert.equal(storage.has("agent_withdrawal_intent:qa-user"), false);
  assert.equal(resumed.data.recovering, false);
});

test("a late result from another account cannot erase the current account draft", async () => {
  const storage = new Map();
  let finish;
  const page = mount(async (path, options = {}) => {
    if (options.method === "POST")
      return new Promise((resolve) => {
        finish = resolve;
      });
    if (path.includes("wallet"))
      return { balance: "100.00", debtBalance: "0.00" };
    return { items: [], total: 0 };
  }, storage);
  page.data.amount = "10.00";
  page.data.accountId = "account-a";
  const pending = page.submit();
  await tick();
  const other = {
    amount: "99.00",
    accountId: "account-b",
    idempotencyKey: "intent-account-b",
  };
  storage.set("agent_user_id", "other");
  storage.set("agent_withdrawal_intent:other", other);
  await page.onShow();
  await tick();
  finish({ id: "accepted-a" });
  await pending;
  assert.equal(page.data.amount, "99.00");
  assert.equal(page.intent.idempotencyKey, "intent-account-b");
  assert.equal(storage.get("agent_withdrawal_intent:other"), other);
});

test("cold start waits for authenticated identity before reading a saved intent", async () => {
  const storage = new Map();
  let authenticated;
  let reads = 0;
  const ready = new Promise((resolve) => {
    authenticated = resolve;
  });
  const page = mount(
    async (path) => {
      reads++;
      return path.includes("wallet")
        ? { balance: "100.00" }
        : { items: [], total: 0 };
    },
    storage,
    ready,
  );
  const shown = page.onShow();
  await tick();
  assert.equal(reads, 0);
  storage.set("agent_user_id", "new-owner");
  authenticated();
  await shown;
  await tick();
  assert.equal(page.storageKey, "agent_withdrawal_intent:new-owner");
  assert.equal(reads, 3);
});
