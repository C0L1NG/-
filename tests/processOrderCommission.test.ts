import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "../generated/prisma/client.js";
import { processOrderCommission } from "../src/processOrderCommission.js";

const orderId = "11111111-1111-4111-8111-111111111111";
const promoterId = "22222222-2222-4222-8222-222222222222";
const parentId = "33333333-3333-4333-8333-333333333333";

function fakeDatabase(parent: string | null, settlementStatus = "pending", paymentStatus = "paid") {
  const queries: string[] = [];
  const wallets: Array<{ userId: string; balance: string; totalEarned: string }> = [];
  const agentLogs: Array<Record<string, unknown>> = [];
  const platformLogs: Array<Record<string, unknown>> = [];
  const statusUpdates: unknown[] = [];
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      queries.push(sql);
      if (sql.includes("FROM orders")) {
        return [{ id: orderId, promoter_id: promoterId, profit_amount: "123.45",
          payment_status: paymentStatus, settlement_status: settlementStatus }];
      }
      return [{ id: promoterId, parent_id: parent }];
    },
    wallet: {
      updateMany: async ({ where, data }: any) => {
        wallets.push({ userId: where.userId, balance: data.balance.increment,
          totalEarned: data.totalEarned.increment });
        return { count: 1 };
      },
    },
    platformCommissionLog: { create: async ({ data }: any) => { platformLogs.push(data); } },
    commissionLog: { create: async ({ data }: any) => { agentLogs.push(data); } },
    order: { updateMany: async (args: unknown) => { statusUpdates.push(args); return { count: 1 }; } },
  };
  const client = { $transaction: async (fn: (transaction: any) => Promise<unknown>) => fn(tx) } as unknown as PrismaClient;
  return { client, queries, wallets, agentLogs, platformLogs, statusUpdates };
}

test("A: one agent wallet and one commission log, plus platform ledger", async () => {
  const db = fakeDatabase(null);
  const result = await processOrderCommission(orderId, db.client);
  assert.equal(result.status, "settled");
  assert.deepEqual(db.wallets, [{ userId: promoterId, balance: "86.41", totalEarned: "86.41" }]);
  assert.deepEqual(db.agentLogs.map(({ recipientId, roleType, rate, commissionAmount }) =>
    ({ recipientId, roleType, rate, commissionAmount })),
    [{ recipientId: promoterId, roleType: "PROMOTER", rate: "0.70", commissionAmount: "86.41" }]);
  assert.equal(db.platformLogs[0].commissionAmount, "37.04");
  assert.equal(db.statusUpdates.length, 1);
  assert.match(db.queries[0], /FOR UPDATE/);
  assert.match(db.queries[1], /FOR SHARE/);
});

test("B: only promoter and direct parent are credited; no third-level lookup", async () => {
  const db = fakeDatabase(parentId);
  const result = await processOrderCommission(orderId, db.client);
  assert.deepEqual(result, {
    status: "settled", orderId, platformAmount: "37.04", bonusPool: "86.41",
    promoterAmount: "60.49", parentAmount: "25.92",
  });
  assert.deepEqual(db.wallets, [
    { userId: promoterId, balance: "60.49", totalEarned: "60.49" },
    { userId: parentId, balance: "25.92", totalEarned: "25.92" },
  ]);
  assert.deepEqual(db.agentLogs.map(({ roleType, rate, commissionAmount }) =>
    ({ roleType, rate, commissionAmount })), [
    { roleType: "PROMOTER", rate: "0.49", commissionAmount: "60.49" },
    { roleType: "PARENT", rate: "0.21", commissionAmount: "25.92" },
  ]);
  assert.equal(db.platformLogs.length, 1);
  assert.equal(db.queries.length, 2);
});

test("settled callback is idempotent and unpaid order cannot mutate balances", async () => {
  const settled = fakeDatabase(parentId, "settled");
  assert.deepEqual(await processOrderCommission(orderId, settled.client),
    { status: "already_settled", orderId });
  assert.equal(settled.wallets.length + settled.agentLogs.length + settled.platformLogs.length, 0);

  const unpaid = fakeDatabase(null, "pending", "pending");
  await assert.rejects(processOrderCommission(orderId, unpaid.client), /has not been paid/);
  assert.equal(unpaid.wallets.length + unpaid.agentLogs.length + unpaid.platformLogs.length, 0);
});
