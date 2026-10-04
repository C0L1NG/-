import { NextRequest, NextResponse } from "next/server";
import { proxyAdminGet } from "@/lib/proxy";
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return NextResponse.json({ code: "INVALID_ID" }, { status: 400 });
  return proxyAdminGet(`withdrawals/${id}/payout-details`, request);
}
