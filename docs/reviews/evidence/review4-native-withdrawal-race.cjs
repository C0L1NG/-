// Read-only reproduction: no network, credentials, or production writes.
// Run from repository root with Node. The old response must not replace page 2.
const fs = require("node:fs");
const vm = require("node:vm");
let definition;
const pending = [];
vm.runInNewContext(
  fs.readFileSync("miniprogram/pages/withdrawals/index.js", "utf8"),
  {
    require: (name) =>
      name.includes("privacy")
        ? { syncPrivacy() {} }
        : {
            request(path) {
              return new Promise((resolve) => pending.push({ path, resolve }));
            },
          },
    Page: (value) => (definition = value),
    wx: {},
  },
);
const page = {
  ...definition,
  data: { ...definition.data },
  setData(patch) {
    Object.assign(this.data, patch);
  },
};
const first = page.load();
page.next();
function resolveBatch(offset, id, balance) {
  for (let i = offset; i < offset + 3; i++) {
    pending[i].resolve(
      pending[i].path.includes("/wallet")
        ? { balance }
        : { items: [{ id, verified: true }], total: 45 },
    );
  }
}
resolveBatch(3, "page-2-record", "200.00");
setImmediate(async () => {
  resolveBatch(0, "page-1-record", "100.00");
  await first;
  console.log(
    JSON.stringify(
      {
        scenario: "page 2 resolves before older page 1 request",
        currentPage: page.data.page,
        displayedRecord: page.data.items[0].id,
        displayedBalance: page.data.wallet.balance,
        staleResponseOverwroteCurrentPage:
          page.data.page === 2 && page.data.items[0].id === "page-1-record",
      },
      null,
      2,
    ),
  );
});
