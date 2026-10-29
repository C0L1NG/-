const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function mount(file, request) {
  let definition;
  vm.runInNewContext(fs.readFileSync(file, "utf8"), {
    require: (name) =>
      name.includes("privacy") ? { syncPrivacy() {} } : { request },
    Page: (value) => {
      definition = value;
    },
    wx: {},
  });
  return {
    ...definition,
    data: { ...definition.data },
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
}

test("agent keeps the last balance and can update activity when overview fails", async () => {
  const page = mount("miniprogram/pages/home/index.js", async (path) => {
    if (path.includes("overview"))
      throw Object.assign(new Error("unavailable"), { statusCode: 500 });
    return { items: [{ id: "new", commissionAmount: "12.30" }] };
  });
  page.data.overview = { balance: "10.00" };
  await page.load();
  assert.equal(page.data.overview.balance, "10.00");
  assert.equal(page.data.items[0].id, "new");
  assert.equal(page.authFailure, false);
  assert.match(page.data.error, /概览/);
});

test("owner daily brief updates independently from full-period overview", async () => {
  const page = mount(
    "admin_miniprogram/pages/dashboard/index.js",
    async (path) => {
      if (path.includes("period=day")) return { paidOrderCount: 3 };
      throw new Error("unavailable");
    },
  );
  page.data.all = { totalGmv: "50.00" };
  await page.load();
  assert.equal(page.data.all.totalGmv, "50.00");
  assert.equal(page.data.day.paidOrderCount, 3);
  assert.equal(page.data.loading, false);
});
