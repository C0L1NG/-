import { NextRequest } from "next/server";
import { proxyAdminGet } from "@/lib/proxy";
export function GET(request: NextRequest) {
  return proxyAdminGet("payout-accounts", request);
}
import { proxyMutation } from "@/lib/auth-proxy";
export function POST(request: NextRequest) {
  return proxyMutation(request, "/api/admin/payout-accounts", "admin");
}
