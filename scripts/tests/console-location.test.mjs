import test from "node:test";
import assert from "node:assert/strict";
import {
  readConsoleLocation,
  writeConsoleLocation,
} from "../../web/lib/console-location.ts";
import { parseWithdrawalIntent } from "../../web/lib/withdrawal-intent.ts";

test("console task links round trip filters and reject invalid date/page state", () => {
  const state = {
    view: "audit",
    period: "month",
    page: 3,
    q: "订单",
    bounds: { from: "2026-10-01", to: "2026-11-01" },
  };
  const url = writeConsoleLocation(
    new URL("https://example.com/admin/pc/?keep=yes"),
    state,
  );
  assert.deepEqual(readConsoleLocation(url.searchParams), state);
  assert.equal(url.searchParams.get("keep"), "yes");
  assert.deepEqual(
    readConsoleLocation(
      new URLSearchParams("view=secret&page=-2&from=2026-02-30"),
    ),
    { view: "overview", period: "all", page: 1, q: "", bounds: {} },
  );
});

test("persisted withdrawal intents contain the exact original payload and validate storage", () => {
  const intent = {
    amount: "12.30",
    accountId: "12345678-1234-1234-1234-123456789012",
    idempotencyKey: "pending-intent-123",
  };
  assert.deepEqual(parseWithdrawalIntent(JSON.stringify(intent)), intent);
  assert.equal(parseWithdrawalIntent('{"amount":"NaN"}'), null);
  assert.equal(parseWithdrawalIntent("broken"), null);
});
