import { NextRequest } from "next/server";
import { proxyAgentGet } from "@/lib/proxy";
export function GET(request: NextRequest) {
  return proxyAgentGet("payout-accounts", request);
}
import { proxyMutation } from "@/lib/auth-proxy";
export function POST(request: NextRequest) {
  return proxyMutation(request, "/api/agent/payout-accounts", "agent");
}
