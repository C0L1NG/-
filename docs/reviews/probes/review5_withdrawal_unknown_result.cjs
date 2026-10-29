// Review probe: actual native page, simulated responses. No network or real funds.
// First request is accepted by the simulated server, but its response is lost.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
let definition;
const requests = [];
const accepted = new Map();
vm.runInNewContext(
  fs.readFileSync("miniprogram/pages/withdrawals/index.js", "utf8"),
  {
    require: (name) => name.includes("privacy") ? { syncPrivacy() {} } : {
      async request(path, options) {
        assert.equal(path, "/api/agent/withdrawals");
        const data = { ...options.data };
        requests.push(data);
        if (!accepted.has(data.idempotencyKey)) {
          accepted.set(data.idempotencyKey, data);
          throw new Error("模拟：服务端已接收，但响应超时");
        }
        const previous = accepted.get(data.idempotencyKey);
        if (previous.amount !== data.amount || previous.accountId !== data.accountId)
          throw new Error("IDEMPOTENCY_CONFLICT");
        return { id: "simulated-withdrawal", amount: previous.amount };
      },
    },
    Page: (value) => { definition = value; },
    wx: { showToast() {} },
  },
);
const page = {
  ...definition,
  data: { ...definition.data, amount: "100.00", accountId: "simulated-account" },
  setData(patch) { Object.assign(this.data, patch); },
};
(async () => {
  await page.submit();
  page.onAmount({ detail: { value: "200.00" } });
  await page.submit();
  const result = {
    simulatedServer: true,
    acceptedOriginalAmount: [...accepted.values()][0].amount,
    editedAmount: requests[1].amount,
    sameKeyUsedForDifferentPayload: requests[0].idempotencyKey === requests[1].idempotencyKey,
    displayedError: page.data.error,
    keyStillUnresolved: page.key === requests[0].idempotencyKey,
  };
  assert.equal(result.sameKeyUsedForDifferentPayload, true);
  assert.equal(result.displayedError, "IDEMPOTENCY_CONFLICT");
  console.log(JSON.stringify(result, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
