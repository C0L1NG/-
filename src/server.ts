import "dotenv/config";
import { getPrismaClient } from "./db.js";
import { buildAgentApp } from "./agentPortal/routes.js";
import { WechatApiClient } from "./wechat.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const port = Number(process.env.PORT ?? "3000");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be 1–65535");

const db = getPrismaClient();
const wechat = process.env.WECHAT_APP_ID && process.env.WECHAT_APP_SECRET
  ? new WechatApiClient(process.env.WECHAT_APP_ID, process.env.WECHAT_APP_SECRET)
  : undefined;
const app = await buildAgentApp({
  db,
  jwtSecret: required("JWT_SECRET"),
  jwtIssuer: required("JWT_ISSUER"),
  jwtAudience: required("JWT_AUDIENCE"),
  adminJwtAudience: process.env.ADMIN_JWT_AUDIENCE ?? "admin-portal",
  referralBaseUrl: required("AGENT_REFERRAL_BASE_URL"),
  wechat,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await app.close();
    await db.$disconnect();
    process.exit(0);
  });
}

await app.listen({ port, host: "0.0.0.0" });
