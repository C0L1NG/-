import type { FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient, UserRole } from "../../generated/prisma/client.js";

declare module "fastify" {
  interface FastifyRequest {
    authUserId: string | null;
    authRole: UserRole | null;
    agentId: string | null;
    adminId: string | null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function audienceContains(value: unknown, required: string): boolean {
  return value === required || (Array.isArray(value) && value.includes(required));
}

export function requireRole(db: PrismaClient, role: UserRole, audience: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ code: "UNAUTHORIZED", message: "Valid bearer token required" });
    }

    const claims = request.user;
    if (typeof claims !== "object" || claims === null) {
      return reply.code(401).send({ code: "UNAUTHORIZED", message: "Invalid token claims" });
    }
    const verifiedClaims = claims as { sub?: unknown; exp?: unknown; aud?: unknown };
    if (typeof verifiedClaims.sub !== "string" || !UUID.test(verifiedClaims.sub) ||
        typeof verifiedClaims.exp !== "number" || !Number.isInteger(verifiedClaims.exp) ||
        !audienceContains(verifiedClaims.aud, audience)) {
      return reply.code(401).send({ code: "UNAUTHORIZED", message: "Invalid token claims" });
    }

    // Authorization uses the current database role, never a role supplied by the client.
    const user = await db.user.findUnique({
      where: { id: verifiedClaims.sub },
      select: { id: true, role: true },
    });
    if (!user) {
      return reply.code(401).send({ code: "UNAUTHORIZED", message: "Account not found" });
    }
    if (user.role !== role) {
      return reply.code(403).send({ code: "FORBIDDEN", message: `${role} access only` });
    }
    request.authUserId = user.id;
    request.authRole = user.role;
    if (role === "AGENT") request.agentId = user.id;
    if (role === "ADMIN") request.adminId = user.id;
  };
}

export const requireAgent = (db: PrismaClient, audience = "agent-portal") =>
  requireRole(db, "AGENT", audience);
export const requireAdmin = (db: PrismaClient, audience = "admin-portal") =>
  requireRole(db, "ADMIN", audience);

export function currentAgentId(request: FastifyRequest): string {
  if (!request.agentId) throw new Error("Agent authentication hook was not run");
  return request.agentId;
}

export function currentAdminId(request: FastifyRequest): string {
  if (!request.adminId) throw new Error("Admin authentication hook was not run");
  return request.adminId;
}
