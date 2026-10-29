import { NextRequest } from "next/server";
import { proxyAdminGet } from "@/lib/proxy";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  return proxyAdminGet(
    `withdrawal-intents/${encodeURIComponent(key)}`,
    request,
  );
}
