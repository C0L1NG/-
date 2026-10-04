import { NextRequest, NextResponse } from "next/server";
import { proxyMutation } from "@/lib/auth-proxy";
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return NextResponse.json({ code: "INVALID_ID" }, { status: 400 });
  return proxyMutation(
    request,
    `/api/admin/payment-events/${id}/retry`,
    "admin",
  );
}
