import type { NextRequest } from "next/server";
import { proxyAgentGet } from "@/lib/proxy";
export const dynamic = "force-dynamic";
export function GET(request: NextRequest) {
  return proxyAgentGet("activity-summary", request);
}
