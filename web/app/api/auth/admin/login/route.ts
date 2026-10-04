import { NextRequest } from "next/server";
import { proxyMutation } from "@/lib/auth-proxy";
export function POST(request: NextRequest) {
  return proxyMutation(request, "/api/auth/admin/login", "admin", true);
}
