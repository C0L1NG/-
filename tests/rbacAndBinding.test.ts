import assert from "node:assert/strict";
import test from "node:test";
import Decimal from "decimal.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { buildAgentApp } from "../src/agentPortal/routes.js";
import { bindDirectParent } from "../src/agentPortal/bindParent.js";

const agentId = "11111111-1111-4111-8111-111111111111";
const parentId = "22222222-2222-4222-8222-222222222222";
const adminId = "33333333-3333-4333-8333-333333333333";

test("admin and agent audiences plus current database roles isolate both API domains", async (t) => {
  const db = {
    user: {
      findUnique: async ({ where }: any) => ({ id: where.id, role: where.id === adminId ? "ADMIN" : "AGENT" }),
      count: async () => 2,
    },
    platformCommissionLog: { aggregate: async () => ({ _sum: { commissionAmount: new Decimal("30.00") } }) },
    commissionLog: { aggregate: async () => ({ _sum: { commissionAmount: new Decimal("70.00") } }) },
    order: { aggregate: async () => ({ _sum: { totalAmount: new Decimal("250.00") } }), count: async () => 1 },
  } as unknown as PrismaClient;
  const app = await buildAgentApp({ db, jwtSecret: "0123456789abcdef0123456789abcdef",
    jwtIssuer: "issuer", jwtAudience: "agent-mini", adminJwtAudience: "admin-web",
    referralBaseUrl: "https://example.com/register" });
  t.after(() => app.close());
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const agentToken = app.jwt.sign({ sub: agentId, iss: "issuer", aud: "agent-mini", exp });
  const adminToken = app.jwt.sign({ sub: adminId, iss: "issuer", aud: "admin-web", exp });

  assert.equal((await app.inject({ url: "/api/admin/overview", headers: { authorization: `Bearer ${agentToken}` } })).statusCode, 401);
  assert.equal((await app.inject({ url: "/api/agent/overview", headers: { authorization: `Bearer ${adminToken}` } })).statusCode, 401);
  const overview = await app.inject({ url: "/api/admin/overview", headers: { authorization: `Bearer ${adminToken}` } });
  assert.equal(overview.statusCode, 200);
  assert.deepEqual(overview.json(), { platformTotalRevenue: "30.00", totalGmv: "250.00",
    agentCommissionPool: "70.00", agentCount: 2, paidOrderCount: 1 });
});

function bindingDb(targetParent: string | null = null) {
  const updates: any[] = [];
  const tx = {
    $queryRaw: async () => [
      { id: agentId, parent_id: null, referral_code: "SELF" },
      { id: parentId, parent_id: targetParent, referral_code: "PARENT01" },
    ],
    user: { count: async () => 0, updateMany: async (args: any) => { updates.push(args); return { count: 1 }; } },
  };
  const db = { $transaction: async (fn: any) => fn(tx) } as unknown as PrismaClient;
  return { db, updates };
}

test("scan binding locks rows and permanently binds only to a root agent", async () => {
  const ok = bindingDb();
  assert.deepEqual(await bindDirectParent(agentId, "PARENT01", ok.db), { status: "bound", parentId });
  assert.equal(ok.updates[0].where.id, agentId);
  assert.equal(ok.updates[0].where.parentId, null);
  assert.equal(ok.updates[0].data.parentId, parentId);

  const thirdLevel = bindingDb("44444444-4444-4444-8444-444444444444");
  await assert.rejects(bindDirectParent(agentId, "PARENT01", thirdLevel.db),
    (error: any) => error.code === "THIRD_LEVEL_FORBIDDEN");
  assert.equal(thirdLevel.updates.length, 0);
});
