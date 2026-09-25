import type { PrismaClient } from "../../generated/prisma/client.js";

type LockedAgent = {
  id: string;
  parent_id: string | null;
  referral_code: string | null;
};

export class ParentBindingError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 409) {
    super(message);
  }
}

/** Permanently binds an unparented agent to one root agent. Both rows are locked. */
export async function bindDirectParent(agentId: string, referralCode: string, db: PrismaClient) {
  const code = referralCode.trim();
  if (!code || code.length > 64) throw new ParentBindingError("INVALID_REFERRAL_CODE", "Invalid referral code", 400);

  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<LockedAgent[]>`
      SELECT id, parent_id, referral_code
      FROM users
      WHERE role = 'agent'
        AND (id = CAST(${agentId} AS uuid) OR referral_code = ${code})
      ORDER BY id
      FOR UPDATE
    `;
    const current = rows.find((row) => row.id === agentId);
    const parent = rows.find((row) => row.referral_code === code);
    if (!current) throw new ParentBindingError("AGENT_NOT_FOUND", "Agent account not found", 401);
    if (!parent) throw new ParentBindingError("REFERRAL_NOT_FOUND", "Referral code not found", 404);
    if (parent.id === current.id) throw new ParentBindingError("SELF_REFERRAL", "An agent cannot bind to themselves");
    if (current.parent_id) {
      if (current.parent_id === parent.id) return { status: "already_bound" as const, parentId: parent.id };
      throw new ParentBindingError("PARENT_ALREADY_BOUND", "Parent binding cannot be changed");
    }
    if (parent.parent_id) {
      throw new ParentBindingError("THIRD_LEVEL_FORBIDDEN", "Only root agents can invite direct agents");
    }

    const children = await tx.user.count({ where: { parentId: current.id, role: "AGENT" } });
    if (children > 0) {
      throw new ParentBindingError("AGENT_HAS_TEAM", "An agent with a team cannot become a second-level agent");
    }
    const updated = await tx.user.updateMany({
      where: { id: current.id, role: "AGENT", parentId: null },
      data: { parentId: parent.id, parentBoundAt: new Date() },
    });
    if (updated.count !== 1) throw new ParentBindingError("BINDING_CONFLICT", "Parent binding changed concurrently");
    return { status: "bound" as const, parentId: parent.id };
  });
}
