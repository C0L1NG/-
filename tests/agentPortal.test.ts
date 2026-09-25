import assert from "node:assert/strict";
import test from "node:test";
import Decimal from "decimal.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { buildAgentApp } from "../src/agentPortal/routes.js";

const agentId = "11111111-1111-4111-8111-111111111111";
const otherAgentId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-09-22T12:00:00.000Z");

function setup(role: "AGENT" | "ADMIN" = "AGENT", parentId: string | null = null) {
  const orderQueries: any[] = [];
  const ledgerQueries: any[] = [];
  const db = {
    user: {
      findUnique: async ({ where, select }: any) => {
        if (select.role) return { id: where.id, role };
        if (select.parentId) return { parentId, displayName: "青禾" };
        return { referralCode: "A+B 42" };
      },
      count: async () => parentId ? 0 : 2,
    },
    wallet: {
      findUnique: async () => ({ balance: new Decimal("25.30"), totalEarned: new Decimal("100.00") }),
    },
    order: {
      findMany: async (args: any) => {
        orderQueries.push(args);
        return parentId
          ? [{ id: "a", promoterId: agentId, profitAmount: new Decimal("100.00"),
              promoter: { parentId } }]
          : [
              { id: "a", promoterId: agentId, profitAmount: new Decimal("100.00"),
                promoter: { parentId: null } },
              { id: "b", promoterId: otherAgentId, profitAmount: new Decimal("100.00"),
                promoter: { parentId: agentId } },
            ];
      },
    },
    commissionLog: {
      count: async (args: any) => { ledgerQueries.push(args); return 3; },
      findMany: async (args: any) => {
        ledgerQueries.push(args);
        return [{
          id: "log-1", roleType: "PARENT", rate: new Decimal("0.21"),
          commissionAmount: new Decimal("21.00"), createdAt: now,
          order: { orderNo: "ORD-1", profitAmount: new Decimal("100.00"), settlementStatus: "SETTLED" },
        }];
      },
    },
  } as unknown as PrismaClient;
  return { db, orderQueries, ledgerQueries };
}

async function createApp(db: PrismaClient) {
  const app = await buildAgentApp({
    db,
    jwtSecret: "0123456789abcdef0123456789abcdef",
    jwtIssuer: "test-issuer",
    jwtAudience: "agent-portal",
    referralBaseUrl: "https://example.com/register?campaign=autumn",
    now: () => now,
  });
  const token = app.jwt.sign({
    sub: agentId,
    iss: "test-issuer",
    aud: "agent-portal",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const headers = { authorization: `Bearer ${token}` };
  return { app, headers };
}

test("all agent routes require a verified, unexpired bearer token and current agent role", async (t) => {
  const { db } = setup();
  const { app, headers } = await createApp(db);
  t.after(() => app.close());
  for (const path of ["/api/agent/overview", "/api/agent/referral", "/api/agent/ledger"]) {
    assert.equal((await app.inject({ url: path })).statusCode, 401);
  }
  assert.equal((await app.inject({ url: "/api/agent/overview",
    headers: { authorization: "Bearer invalid" } })).statusCode, 401);

  const withoutExpiry = app.jwt.sign({ sub: agentId, iss: "test-issuer", aud: "agent-portal" });
  assert.equal((await app.inject({ url: "/api/agent/overview",
    headers: { authorization: `Bearer ${withoutExpiry}` } })).statusCode, 401);
  const expired = app.jwt.sign({ sub: agentId, iss: "test-issuer", aud: "agent-portal",
    exp: Math.floor(Date.now() / 1000) - 1 });
  assert.equal((await app.inject({ url: "/api/agent/overview",
    headers: { authorization: `Bearer ${expired}` } })).statusCode, 401);
  const wrongAudience = app.jwt.sign({ sub: agentId, iss: "test-issuer", aud: "another-app",
    exp: Math.floor(Date.now() / 1000) + 3600 });
  assert.equal((await app.inject({ url: "/api/agent/overview",
    headers: { authorization: `Bearer ${wrongAudience}` } })).statusCode, 401);
  assert.equal((await app.inject({ url: "/api/agent/referral", headers })).statusCode, 200);

  const admin = await createApp(setup("ADMIN").db);
  t.after(() => admin.app.close());
  assert.equal((await admin.app.inject({ url: "/api/agent/overview", headers: admin.headers })).statusCode, 403);
});

test("overview reads only the agent's wallet, downlines and own pending commissions", async (t) => {
  const db = setup();
  const { app, headers } = await createApp(db.db);
  t.after(() => app.close());
  const response = await app.inject({ url: "/api/agent/overview", headers });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    displayName: "青禾",
    balance: "25.30", totalEarned: "100.00", directAgentCount: 2,
    currentCommissionRatePercent: 70,
    todayEstimatedEarnings: "91.00", estimateDate: "2026-09-22", estimateTimeZone: "UTC",
  });
  assert.deepEqual(db.orderQueries[0].where.OR,
    [{ promoterId: agentId }, { promoter: { is: { parentId: agentId } } }]);
  assert.equal(db.orderQueries[0].where.paymentStatus, "PAID");
  assert.equal(db.orderQueries[0].where.settlementStatus, "PENDING");
});

test("child agent overview uses the 49% own-order rate", async (t) => {
  const { app, headers } = await createApp(setup("AGENT", otherAgentId).db);
  t.after(() => app.close());
  const response = await app.inject({ url: "/api/agent/overview", headers });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().currentCommissionRatePercent, 49);
  assert.equal(response.json().todayEstimatedEarnings, "49.00");
  assert.equal(response.json().directAgentCount, 0);
});

test("referral returns the agent's code in an encoded full URL", async (t) => {
  const { app, headers } = await createApp(setup().db);
  t.after(() => app.close());
  const response = await app.inject({ url: "/api/agent/referral", headers });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    referralCode: "A+B 42",
    referralUrl: "https://example.com/register?campaign=autumn&ref=A%2BB+42",
  });
});

test("ledger validates pagination and always scopes both queries to the token subject", async (t) => {
  const db = setup();
  const { app, headers } = await createApp(db.db);
  t.after(() => app.close());
  const response = await app.inject({ url: "/api/agent/ledger?page=2&pageSize=1", headers });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    page: 2, pageSize: 1, total: 3, totalPages: 3,
    items: [{ id: "log-1", orderNo: "ORD-1", orderProfitAmount: "100.00", earningType: "DOWNLINE_REWARD",
      roleType: "PARENT", rate: "0.21", ratePercent: 21,
      commissionAmount: "21.00", settlementStatus: "SETTLED",
      settledAt: "2026-09-22T12:00:00.000Z" }],
  });
  assert.deepEqual(db.ledgerQueries[0].where, { recipientId: agentId });
  assert.deepEqual(db.ledgerQueries[1].where, { recipientId: agentId });
  assert.equal(db.ledgerQueries[1].skip, 1);
  assert.equal(db.ledgerQueries[1].take, 1);
  assert.equal((await app.inject({ url: `/api/agent/ledger?recipientId=${otherAgentId}`,
    headers })).statusCode, 400);
  for (const query of ["page=0", "page=abc", "pageSize=101", "pageSize=1.5"]) {
    assert.equal((await app.inject({ url: `/api/agent/ledger?${query}`, headers })).statusCode, 400);
  }
});
