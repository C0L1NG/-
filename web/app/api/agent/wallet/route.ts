import { NextRequest } from "next/server";
import { proxyAgentGet } from "@/lib/proxy";
export function GET(request: NextRequest) {
  return proxyAgentGet("wallet", request);
}
