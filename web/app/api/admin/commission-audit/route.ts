import type { NextRequest } from "next/server"; import { proxyAdminGet } from "@/lib/proxy";
export const dynamic="force-dynamic"; export const GET=(request:NextRequest)=>proxyAdminGet("commission-audit",request);
