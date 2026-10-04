import { NextRequest } from "next/server";
import { proxyAdminGet } from "@/lib/proxy";
export function GET(request: NextRequest) {
  return proxyAdminGet("payment-events", request);
}
