import Fastify, { type FastifyInstance } from "fastify";
import jwt from "@fastify/jwt";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { requireAgent } from "./auth.js";
import { createAgentControllers } from "./controllers.js";
import { registerAdminRoutes } from "../adminPortal/routes.js";
import { newReferralCode, type WechatProvider } from "../wechat.js";

export type AgentAppOptions = {
  db: PrismaClient;
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  adminJwtAudience?: string;
  referralBaseUrl: string;
  now?: () => Date;
  wechat?: WechatProvider;
};

export async function buildAgentApp(options: AgentAppOptions): Promise<FastifyInstance> {
  if (options.jwtSecret.length < 32) throw new Error("JWT_SECRET must have at least 32 characters");
  if (!options.jwtIssuer || !options.jwtAudience) throw new Error("JWT issuer and audience are required");
  const referralBaseUrl = new URL(options.referralBaseUrl);
  if (referralBaseUrl.protocol !== "https:" &&
      !(referralBaseUrl.protocol === "http:" && referralBaseUrl.hostname === "localhost")) {
    throw new Error("Referral base URL must use HTTPS (HTTP is allowed for localhost)");
  }

  const app = Fastify({ logger: false, ajv: { customOptions: { removeAdditional: false } } });
  await app.register(jwt, {
    secret: options.jwtSecret,
    verify: {
      algorithms: ["HS256"],
      allowedIss: options.jwtIssuer,
      allowedAud: [options.jwtAudience, options.adminJwtAudience ?? "admin-portal"],
    },
  });
  app.decorateRequest("authUserId", null);
  app.decorateRequest("authRole", null);
  app.decorateRequest("agentId", null);
  app.decorateRequest("adminId", null);
  const controllers = createAgentControllers(options.db, referralBaseUrl, options.now ?? (() => new Date()), options.wechat);

  app.post<{ Body: { code: string } }>("/api/auth/wechat/login", {
    schema: { body: { type: "object", required: ["code"], properties: {
      code: { type: "string", minLength: 1, maxLength: 128 } }, additionalProperties: false } },
  }, async (request, reply) => {
    if (!options.wechat) return reply.code(501).send({ code: "WECHAT_NOT_CONFIGURED" });
    const session = await options.wechat.code2Session(request.body.code);
    const user = await options.db.user.upsert({ where: { wechatOpenId: session.openId },
      create: { role: "AGENT", wechatOpenId: session.openId, wechatUnionId: session.unionId,
        referralCode: newReferralCode(), wallet: { create: {} } },
      update: { ...(session.unionId ? { wechatUnionId: session.unionId } : {}) },
      select: { id: true, role: true, parentId: true } });
    if (user.role !== "AGENT") return reply.code(403).send({ code: "AGENT_ACCESS_ONLY" });
    return { accessToken: app.jwt.sign({ sub: user.id, iss: options.jwtIssuer, aud: options.jwtAudience },
      { expiresIn: "2h" }), expiresIn: 7200, agent: { id: user.id, parentId: user.parentId } };
  });

  await app.register(async (routes) => {
    routes.addHook("onRequest", requireAgent(options.db, options.jwtAudience));
    routes.get("/overview", controllers.overview);
    routes.get("/referral", controllers.referral);
    routes.get<{ Querystring: { page?: number; pageSize?: number } }>("/team", {
      schema: { querystring: { type: "object", properties: {
        page: { type: "integer", minimum: 1, maximum: 10000, default: 1 },
        pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      }, additionalProperties: false } },
    }, controllers.team);
    routes.post<{ Body: { referralCode: string } }>("/bind-parent", {
      schema: { body: { type: "object", required: ["referralCode"], properties: {
        referralCode: { type: "string", minLength: 1, maxLength: 64 } }, additionalProperties: false } },
    }, controllers.bindParent);
    routes.get("/mini-program-code", controllers.miniProgramCode);
    routes.get<{ Querystring: { page?: number; pageSize?: number; from?: string; to?: string; roleType?: "PROMOTER" | "PARENT" } }>("/ledger", {
      schema: {
        querystring: {
          type: "object",
          properties: {
            page: { type: "integer", minimum: 1, maximum: 10000, default: 1 },
            pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
            from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            to: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            roleType: { type: "string", enum: ["PROMOTER", "PARENT"] },
          },
          additionalProperties: false,
        },
      },
    }, controllers.ledger);
  }, { prefix: "/api/agent" });

  await registerAdminRoutes(app, options.db, options.adminJwtAudience ?? "admin-portal");

  await app.ready();
  return app;
}
