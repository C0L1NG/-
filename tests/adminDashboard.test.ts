import assert from "node:assert/strict";
import test from "node:test";
import Decimal from "decimal.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createAdminControllers } from "../src/adminPortal/controllers.js";

test("monthly admin totals use one UTC order cohort", async () => {
  const filters: any[] = [];
  const db = {
    platformCommissionLog: { aggregate: async (args: any) => {
      filters.push(args.where); return { _sum: { commissionAmount: new Decimal("30.00") } };
    } },
    commissionLog: { aggregate: async (args: any) => {
      filters.push(args.where); return { _sum: { commissionAmount: new Decimal("70.00") } };
    } },
    order: {
      aggregate: async (args: any) => { filters.push(args.where); return { _sum: { totalAmount: new Decimal("250.00") } }; },
      count: async (args: any) => { filters.push(args.where); return 1; },
    },
    user: { count: async () => 2 },
  } as unknown as PrismaClient;
  const result = await createAdminControllers(db).overview({ query: { period: "month" } } as any);
  assert.equal(result.platformTotalRevenue, "30.00");
  assert.equal(result.agentCommissionPool, "70.00");
  assert.equal(result.totalGmv, "250.00");
  const range = filters[1].createdAt;
  assert.equal(range.gte.getUTCDate(), 1);
  assert.equal(range.gte.getUTCHours(), 0);
  assert.deepEqual(filters[0].order.is.createdAt, range);
  assert.deepEqual(filters[2].order.is.createdAt, range);
  assert.deepEqual(filters[3].createdAt, range);
});

test("daily admin overview counts distinct paid promoters in the same UTC day", async () => {
  const filters: any[] = [];
  const db = {
    platformCommissionLog: { aggregate: async (args: any) => { filters.push(args.where); return { _sum: { commissionAmount: new Decimal("30") } }; } },
    commissionLog: { aggregate: async () => ({ _sum: { commissionAmount: new Decimal("70") } }) },
    order: {
      aggregate: async () => ({ _sum: { totalAmount: new Decimal("250") } }),
      count: async () => 3,
      groupBy: async (args: any) => { filters.push(args.where); return [{ promoterId: "a" }, { promoterId: "b" }]; },
    },
    user: { count: async () => 7 },
  } as unknown as PrismaClient;
  const result = await createAdminControllers(db).overview({ query: { period: "day" } } as any);
  assert.equal(result.activePromoterCount, 2);
  assert.equal(result.paidOrderCount, 3);
  assert.equal(result.platformTotalRevenue, "30.00");
  assert.deepEqual(filters[0].order.is.createdAt, filters[1].createdAt);
  assert.equal(filters[1].paymentStatus, "PAID");
  assert.equal(filters[1].createdAt.lt.getTime() - filters[1].createdAt.gte.getTime(), 86_400_000);
});

test("admin audit filters order number and promoter with the selected period", async () => {
  const filters: any[] = [];
  const db = { order: {
    count: async (args: any) => { filters.push(args.where); return 0; },
    findMany: async (args: any) => { filters.push(args.where); return []; },
  } } as unknown as PrismaClient;
  const result = await createAdminControllers(db).audit({ query: { period: "month", q: "  林默  ", page: 1, pageSize: 5 } } as any);
  assert.equal(result.total, 0);
  assert.deepEqual(filters[0], filters[1]);
  assert.equal(filters[0].OR[0].orderNo.contains, "林默");
  assert.equal(filters[0].OR[1].promoter.is.displayName.contains, "林默");
  assert.ok(filters[0].createdAt.gte instanceof Date);
});

test("team tree reports actual promoter performance and direct mentor earnings", async () => {
  const rootId = "root", childId = "child";
  const agents = [
    { id: rootId, parentId: null, displayName: "一级", referralCode: "ROOT", wallet: { balance: new Decimal("80"), totalEarned: new Decimal("120") } },
    { id: childId, parentId: rootId, displayName: "二级", referralCode: "CHILD", wallet: { balance: new Decimal("30"), totalEarned: new Decimal("40") } },
  ];
  const db = {
    user: { findUnique: async () => ({ id: "admin", displayName: "总控" }), findMany: async () => agents },
    order: { groupBy: async () => [{ promoterId: childId, _sum: { totalAmount: new Decimal("1000") }, _count: { _all: 2 } }] },
    platformCommissionLog: { findMany: async () => [{ id: "p1", commissionAmount: new Decimal("30"), order: { promoterId: childId } }] },
    commissionLog: { findMany: async () => [{ id: "c1", commissionAmount: new Decimal("21"), order: { promoterId: childId } }] },
  } as unknown as PrismaClient;
  const tree = await createAdminControllers(db).teamTree({ adminId: "admin" } as any);
  const root = tree.root.children[0] as any;
  const child = root.children[0];
  assert.equal(root.teamSize, 1);
  assert.equal(child.ownGmv, "1000.00");
  assert.equal(child.ownOrderCount, 2);
  assert.equal(child.platformContribution, "30.00");
  assert.equal(child.mentorPaidUp, "21.00");
  assert.equal(root.mentorPaidUp, "0.00");
});

test("monthly team tree filters orders and both contribution streams to one cohort", async () => {
  const filters: any[] = [];
  const db = {
    user: { findUnique: async () => ({ id: "admin", displayName: "总控" }), findMany: async () => [] },
    order: { groupBy: async (args: any) => { filters.push(args.where); return []; } },
    platformCommissionLog: { findMany: async (args: any) => { filters.push(args.where); return []; } },
    commissionLog: { findMany: async (args: any) => { filters.push(args.where); return []; } },
  } as unknown as PrismaClient;
  await createAdminControllers(db).teamTree({ adminId: "admin", query: { period: "month" } } as any);
  const range = filters[0].createdAt;
  assert.equal(range.gte.getUTCDate(), 1);
  assert.deepEqual(filters[1].order.is.createdAt, range);
  assert.deepEqual(filters[2].order.is.createdAt, range);
  assert.equal(filters[2].roleType, "PARENT");
});
