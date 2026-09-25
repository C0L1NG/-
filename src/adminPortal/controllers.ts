import Decimal from "decimal.js";
import type { FastifyRequest } from "fastify";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { currentAdminId } from "../agentPortal/auth.js";

const money = (value: { toString(): string } | null | undefined) =>
  new Decimal(value?.toString() ?? 0).toFixed(2);

type AdminPeriod = "all" | "month" | "previous_month" | "day";
function periodRange(period: AdminPeriod) {
  if (period === "all") return undefined;
  const now = new Date();
  if (period === "day") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    return { gte: start, lt: new Date(start.getTime() + 86_400_000) };
  }
  const offset = period === "previous_month" ? -1 : 0;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 1));
  return { gte: start, lt: end };
}

export function createAdminControllers(db: PrismaClient) {
  return {
    overview: async (request: FastifyRequest<{ Querystring: { period?: AdminPeriod } }>) => {
      const createdAt = periodRange(request.query.period ?? "all");
      const [platform, gmv, commissions, agents, paidOrders, activePromoters] = await Promise.all([
        db.platformCommissionLog.aggregate({ where: createdAt ? { order: { is: { createdAt } } } : undefined, _sum: { commissionAmount: true } }),
        db.order.aggregate({ where: { paymentStatus: "PAID", ...(createdAt ? { createdAt } : {}) }, _sum: { totalAmount: true } }),
        db.commissionLog.aggregate({ where: createdAt ? { order: { is: { createdAt } } } : undefined, _sum: { commissionAmount: true } }),
        db.user.count({ where: { role: "AGENT" } }),
        db.order.count({ where: { paymentStatus: "PAID", ...(createdAt ? { createdAt } : {}) } }),
        request.query.period === "day" ? db.order.groupBy({ by: ["promoterId"],
          where: { paymentStatus: "PAID", createdAt: createdAt! }, _count: { _all: true } }) : Promise.resolve(null),
      ]);
      return { platformTotalRevenue: money(platform._sum.commissionAmount), totalGmv: money(gmv._sum.totalAmount),
        agentCommissionPool: money(commissions._sum.commissionAmount), agentCount: agents, paidOrderCount: paidOrders,
        ...(activePromoters ? { activePromoterCount: activePromoters.length } : {}) };
    },

    teamTree: async (request: FastifyRequest<{ Querystring: { period?: "all" | "month" } }>) => {
      const adminId = currentAdminId(request);
      const createdAt = periodRange(request.query?.period ?? "all");
      const [admin, agents, orders] = await Promise.all([
        db.user.findUnique({ where: { id: adminId }, select: { id: true, displayName: true } }),
        db.user.findMany({ where: { role: "AGENT" }, select: { id: true, parentId: true,
          displayName: true, referralCode: true, createdAt: true,
          wallet: { select: { balance: true, totalEarned: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
        db.order.groupBy({ by: ["promoterId"], where: { paymentStatus: "PAID", ...(createdAt ? { createdAt } : {}) },
          _sum: { totalAmount: true }, _count: { _all: true } }),
      ]);
      const orderTotals = new Map(orders.map((row) => [row.promoterId, {
        gmv: money(row._sum.totalAmount), count: row._count._all,
      }]));
      const platformTotals = new Map<string, Decimal>();
      let platformCursor: string | undefined;
      for (;;) {
        const logs = await db.platformCommissionLog.findMany({
          where: createdAt ? { order: { is: { createdAt } } } : undefined,
          select: { id: true, commissionAmount: true, order: { select: { promoterId: true } } },
          orderBy: { id: "asc" }, take: 500,
          ...(platformCursor ? { cursor: { id: platformCursor }, skip: 1 } : {}),
        });
        for (const log of logs) {
          const id = log.order.promoterId;
          platformTotals.set(id, (platformTotals.get(id) ?? new Decimal(0)).plus(log.commissionAmount));
        }
        if (logs.length < 500) break;
        platformCursor = logs.at(-1)!.id;
      }
      const mentorTotals = new Map<string, Decimal>();
      let mentorCursor: string | undefined;
      for (;;) {
        const logs = await db.commissionLog.findMany({
          where: { roleType: "PARENT", ...(createdAt ? { order: { is: { createdAt } } } : {}) },
          select: { id: true, commissionAmount: true, order: { select: { promoterId: true } } },
          orderBy: { id: "asc" }, take: 500,
          ...(mentorCursor ? { cursor: { id: mentorCursor }, skip: 1 } : {}),
        });
        for (const log of logs) {
          const id = log.order.promoterId;
          mentorTotals.set(id, (mentorTotals.get(id) ?? new Decimal(0)).plus(log.commissionAmount));
        }
        if (logs.length < 500) break;
        mentorCursor = logs.at(-1)!.id;
      }
      const nodes = new Map(agents.map((agent) => [agent.id, { id: agent.id,
        displayName: agent.displayName ?? "未命名代理", referralCode: agent.referralCode,
        balance: money(agent.wallet?.balance), totalEarned: money(agent.wallet?.totalEarned),
        ownGmv: orderTotals.get(agent.id)?.gmv ?? "0.00",
        ownOrderCount: orderTotals.get(agent.id)?.count ?? 0,
        platformContribution: money(platformTotals.get(agent.id)),
        mentorPaidUp: money(mentorTotals.get(agent.id)),
        teamSize: 0, children: [] as unknown[] }]));
      const roots: unknown[] = [];
      for (const agent of agents) {
        const node = nodes.get(agent.id)!;
        if (agent.parentId && nodes.has(agent.parentId)) {
          const parent = nodes.get(agent.parentId)!;
          parent.children.push(node); parent.teamSize += 1;
        } else roots.push(node);
      }
      return { root: { id: adminId, type: "ADMIN", displayName: admin?.displayName ?? "老板总控", children: roots } };
    },

    agentDetail: async (request: FastifyRequest<{ Params: { agentId: string } }>) => {
      const agent = await db.user.findFirst({ where: { id: request.params.agentId, role: "AGENT" },
        select: { id: true, parentId: true, displayName: true, referralCode: true,
          wallet: { select: { balance: true, frozenBalance: true, totalEarned: true } },
          _count: { select: { children: true, promotedOrders: true } } } });
      if (!agent) return null;
      return { id: agent.id, parentId: agent.parentId, displayName: agent.displayName ?? "未命名代理",
        referralCode: agent.referralCode, balance: money(agent.wallet?.balance),
        frozenBalance: money(agent.wallet?.frozenBalance), totalEarned: money(agent.wallet?.totalEarned),
        directAgentCount: agent._count.children, orderCount: agent._count.promotedOrders };
    },

    audit: async (request: FastifyRequest<{ Querystring: { page?: number; pageSize?: number; period?: AdminPeriod; q?: string } }>) => {
      const page = request.query.page ?? 1, pageSize = request.query.pageSize ?? 20;
      const createdAt = periodRange(request.query.period ?? "all");
      const q = request.query.q?.trim();
      const where = {
        ...(createdAt ? { createdAt } : {}),
        ...(q ? { OR: [
          { orderNo: { contains: q, mode: "insensitive" as const } },
          { promoter: { is: { displayName: { contains: q, mode: "insensitive" as const } } } },
        ] } : {}),
      };
      const [total, orders] = await Promise.all([
        db.order.count({ where }),
        db.order.findMany({ where, select: { id: true, orderNo: true, totalAmount: true,
          profitAmount: true, settlementStatus: true, createdAt: true,
          promoter: { select: { id: true, displayName: true } },
          platformCommission: { select: { rate: true, commissionAmount: true } },
          commissionLogs: { select: { roleType: true, rate: true, commissionAmount: true,
            recipient: { select: { id: true, displayName: true } } } } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
      ]);
      return { page, pageSize, total, totalPages: Math.ceil(total / pageSize), items: orders.map((order) => ({
        id: order.id, orderNo: order.orderNo, totalAmount: money(order.totalAmount), profitAmount: money(order.profitAmount),
        settlementStatus: order.settlementStatus, createdAt: order.createdAt.toISOString(),
        promoter: { id: order.promoter.id, displayName: order.promoter.displayName ?? "未命名代理" },
        platform: order.platformCommission ? { ratePercent: Number(order.platformCommission.rate) * 100,
          amount: money(order.platformCommission.commissionAmount) } : null,
        promoterCommission: order.commissionLogs.filter((log) => log.roleType === "PROMOTER").map((log) => ({
          recipientId: log.recipient.id, recipientName: log.recipient.displayName ?? "未命名代理",
          ratePercent: Number(log.rate) * 100, amount: money(log.commissionAmount) }))[0] ?? null,
        mentorCommission: order.commissionLogs.filter((log) => log.roleType === "PARENT").map((log) => ({
          recipientId: log.recipient.id, recipientName: log.recipient.displayName ?? "未命名代理",
          ratePercent: Number(log.rate) * 100, amount: money(log.commissionAmount) }))[0] ?? null,
      })) };
    },
  };
}
