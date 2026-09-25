import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createAgentControllers } from "../src/agentPortal/controllers.js";

test("ledger role filtering remains scoped to the authenticated agent", async () => {
  const captured: any[] = [];
  const db = { commissionLog: {
    count: async (args: any) => { captured.push(args.where); return 0; },
    findMany: async (args: any) => { captured.push(args.where); return []; },
  } } as unknown as PrismaClient;
  const controller = createAgentControllers(db, new URL("https://example.com/join"), () => new Date());
  const result = await controller.ledger({ agentId: "agent-1", query: { roleType: "PARENT", page: 1, pageSize: 8 } } as any);
  assert.equal(result.total, 0);
  assert.deepEqual(captured, [
    { recipientId: "agent-1", roleType: "PARENT" },
    { recipientId: "agent-1", roleType: "PARENT" },
  ]);
});
