import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { requireAdmin } from "../agentPortal/auth.js";
import { createAdminControllers } from "./controllers.js";

export async function registerAdminRoutes(app: FastifyInstance, db: PrismaClient, audience: string) {
  const controllers = createAdminControllers(db);
  await app.register(async (routes) => {
    routes.addHook("onRequest", requireAdmin(db, audience));
    routes.get<{ Querystring: { period?: "all" | "month" | "previous_month" | "day" } }>("/overview", {
      schema: { querystring: { type: "object", properties: {
        period: { type: "string", enum: ["all", "month", "previous_month", "day"], default: "all" },
      }, additionalProperties: false } },
    }, controllers.overview);
    routes.get<{ Querystring: { period?: "all" | "month" } }>("/team-tree", {
      schema: { querystring: { type: "object", properties: {
        period: { type: "string", enum: ["all", "month"], default: "all" },
      }, additionalProperties: false } },
    }, controllers.teamTree);
    routes.get<{ Params: { agentId: string } }>("/agents/:agentId", {
      schema: { params: { type: "object", required: ["agentId"], properties: {
        agentId: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } }, additionalProperties: false } },
    }, async (request, reply) => (await controllers.agentDetail(request)) ?? reply.code(404).send({ code: "AGENT_NOT_FOUND" }));
    routes.get<{ Querystring: { page?: number; pageSize?: number; period?: "all" | "month"; q?: string } }>("/commission-audit", {
      schema: { querystring: { type: "object", properties: { page: { type: "integer", minimum: 1, default: 1 },
        pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        period: { type: "string", enum: ["all", "month"], default: "all" },
        q: { type: "string", maxLength: 80 } }, additionalProperties: false } },
    }, controllers.audit);
  }, { prefix: "/api/admin" });
}
