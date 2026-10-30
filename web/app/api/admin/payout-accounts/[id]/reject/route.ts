import { NextRequest } from "next/server";
import { proxyMutation } from "@/lib/auth-proxy";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyMutation(
    request,
    `/api/admin/payout-accounts/${encodeURIComponent(id)}/reject`,
    "admin",
  );
}
