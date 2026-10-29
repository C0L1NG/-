import { NextRequest } from "next/server";
import { proxyAgentGet } from "@/lib/proxy";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  return proxyAgentGet(
    `withdrawal-intents/${encodeURIComponent(key)}`,
    request,
  );
}
