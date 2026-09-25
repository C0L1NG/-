import Decimal from "decimal.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { calculateOrderCommission } from "../commissionMath.js";
import { currentAgentId } from "./auth.js";
import { bindDirectParent, ParentBindingError } from "./bindParent.js";
import type { WechatProvider } from "../wechat.js";

type LedgerQuery = { page?: number; pageSize?: number; from?: string; to?: string; roleType?: "PROMOTER" | "PARENT" };
type TeamQuery = { page?: number; pageSize?: number };

function money(value: { toString(): string }): string {
  return new Decimal(value.toString()).toFixed(2);
}

function utcDayRange(now: Date) {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export function createAgentControllers(
  db: PrismaClient,
  referralBaseUrl: URL,
  now: () => Date,
  wechat?: WechatProvider,
) {
  return {
    overview: async (request: FastifyRequest, reply: FastifyReply) => {
      const agentId = currentAgentId(request);
      const { start, end } = utcDayRange(now());
      const [wallet, directAgents, agent] = await Promise.all([
        db.wallet.findUnique({
          where: { userId: agentId },
          select: { balance: true, totalEarned: true },
        }),
        db.user.count({ where: { parentId: agentId, role: "AGENT" } }),
        db.user.findUnique({ where: { id: agentId }, select: { parentId: true, displayName: true, avatarUrl: true } }),
      ]);
      if (!wallet) {
        return reply.code(409).send({ code: "WALLET_NOT_FOUND", message: "Agent wallet is missing" });
      }
      if (!agent) {
        return reply.code(401).send({ code: "UNAUTHORIZED", message: "Account not found" });
      }

      let estimated = new Decimal(0);
      let cursor: string | undefined;
      // Work in bounded batches so today's pending orders do not all enter memory.
      for (;;) {
        const orders = await db.order.findMany({
          where: {
            paymentStatus: "PAID",
            settlementStatus: "PENDING",
            createdAt: { gte: start, lt: end },
            OR: [
              { promoterId: agentId },
              { promoter: { is: { parentId: agentId } } },
            ],
          },
          select: {
            id: true,
            promoterId: true,
            profitAmount: true,
            promoter: { select: { parentId: true } },
          },
          orderBy: { id: "asc" },
          take: 500,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        for (const order of orders) {
          const amounts = calculateOrderCommission(
            order.profitAmount.toString(), order.promoter.parentId !== null,
          );
          const ownAmount = order.promoterId === agentId
            ? amounts.promoterAmount
            : order.promoter.parentId === agentId ? amounts.parentAmount : null;
          if (ownAmount !== null) estimated = estimated.plus(ownAmount);
        }
        if (orders.length < 500) break;
        cursor = orders.at(-1)!.id;
      }

      return {
        displayName: agent.displayName ?? "代理伙伴",
        avatarUrl: agent.avatarUrl,
        balance: money(wallet.balance),
        totalEarned: money(wallet.totalEarned),
        directAgentCount: directAgents,
        currentCommissionRatePercent: agent.parentId ? 49 : 70,
        todayEstimatedEarnings: estimated.toFixed(2),
        estimateDate: start.toISOString().slice(0, 10),
        estimateTimeZone: "UTC",
      };
    },

    referral: async (request: FastifyRequest, reply: FastifyReply) => {
      const agentId = currentAgentId(request);
      const user = await db.user.findUnique({
        where: { id: agentId },
        select: { referralCode: true },
      });
      if (!user?.referralCode) {
        return reply.code(409).send({ code: "REFERRAL_CODE_NOT_FOUND", message: "Agent referral code is missing" });
      }
      const url = new URL(referralBaseUrl);
      url.searchParams.set("ref", user.referralCode);
      return { referralCode: user.referralCode, referralUrl: url.toString() };
    },

    team: async (request: FastifyRequest<{ Querystring: TeamQuery }>) => {
      const agentId = currentAgentId(request);
      const page = request.query.page ?? 1;
      const pageSize = request.query.pageSize ?? 20;
      const where = { parentId: agentId, role: "AGENT" as const };
      const [total, agents] = await Promise.all([
        db.user.count({ where }),
        db.user.findMany({ where, select: { id: true, displayName: true, avatarUrl: true,
          createdAt: true, wallet: { select: { totalEarned: true } } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
      ]);
      const ids = agents.map((agent) => agent.id);
      const rewards = ids.length ? await db.commissionLog.findMany({
        where: { recipientId: agentId, roleType: "PARENT", order: { promoterId: { in: ids } } },
        select: { commissionAmount: true, order: { select: { promoterId: true } } },
      }) : [];
      const contribution = new Map<string, Decimal>();
      for (const reward of rewards) contribution.set(reward.order.promoterId,
        (contribution.get(reward.order.promoterId) ?? new Decimal(0)).plus(reward.commissionAmount.toString()));
      return { page, pageSize, total, totalPages: Math.ceil(total / pageSize), items: agents.map((agent) => ({
        id: agent.id, displayName: agent.displayName ?? "未命名代理", avatarUrl: agent.avatarUrl,
        joinedAt: agent.createdAt.toISOString(), totalEarned: money(agent.wallet?.totalEarned ?? new Decimal(0)),
        contributionCommission: (contribution.get(agent.id) ?? new Decimal(0)).toFixed(2),
      })) };
    },

    bindParent: async (request: FastifyRequest<{ Body: { referralCode: string } }>, reply: FastifyReply) => {
      try {
        return await bindDirectParent(currentAgentId(request), request.body.referralCode, db);
      } catch (error) {
        if (error instanceof ParentBindingError) return reply.code(error.statusCode).send({ code: error.code, message: error.message });
        throw error;
      }
    },

    miniProgramCode: async (request: FastifyRequest, reply: FastifyReply) => {
      if (!wechat) return reply.code(501).send({ code: "WECHAT_NOT_CONFIGURED" });
      const agentId = currentAgentId(request);
      const user = await db.user.findUnique({ where: { id: agentId }, select: { referralCode: true } });
      if (!user?.referralCode) return reply.code(409).send({ code: "REFERRAL_CODE_NOT_FOUND" });
      const scene = `r=${user.referralCode}`;
      if (scene.length > 32) return reply.code(409).send({ code: "REFERRAL_CODE_TOO_LONG" });
      const image = await wechat.getUnlimitedCode(scene, "pages/home/index");
      return { scene, page: "pages/home/index", imageDataUrl: `data:${image.contentType};base64,${image.bytes.toString("base64")}` };
    },

    ledger: async (request: FastifyRequest<{ Querystring: LedgerQuery }>) => {
      const agentId = currentAgentId(request);
      const page = request.query.page ?? 1;
      const pageSize = request.query.pageSize ?? 20;
      const createdAt = request.query.from || request.query.to ? {
        ...(request.query.from ? { gte: new Date(`${request.query.from}T00:00:00.000Z`) } : {}),
        ...(request.query.to ? { lt: new Date(`${request.query.to}T00:00:00.000Z`) } : {}),
      } : undefined;
      const where = { recipientId: agentId, ...(createdAt ? { createdAt } : {}),
        ...(request.query.roleType ? { roleType: request.query.roleType } : {}) };
      const [total, logs] = await Promise.all([
        db.commissionLog.count({ where }),
        db.commissionLog.findMany({
          where,
          select: {
            id: true,
            roleType: true,
            rate: true,
            commissionAmount: true,
            createdAt: true,
            order: { select: { orderNo: true, profitAmount: true, settlementStatus: true } },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        items: logs.map((log) => ({
          id: log.id,
          orderNo: log.order.orderNo,
          orderProfitAmount: money(log.order.profitAmount),
          roleType: log.roleType,
          earningType: log.roleType === "PARENT" ? "DOWNLINE_REWARD" : "OWN_ORDER",
          rate: log.rate.toString(),
          ratePercent: new Decimal(log.rate.toString()).mul(100).toNumber(),
          commissionAmount: money(log.commissionAmount),
          settlementStatus: log.order.settlementStatus,
          settledAt: log.createdAt.toISOString(),
        })),
      };
    },
  };
}
