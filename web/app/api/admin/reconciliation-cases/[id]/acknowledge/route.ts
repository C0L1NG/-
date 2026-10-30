import { NextRequest, NextResponse } from "next/server";
import { proxyMutation } from "@/lib/auth-proxy";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[a-f0-9]{64}$/.test(id))
    return NextResponse.json({ code: "INVALID_ID" }, { status: 400 });
  return proxyMutation(
    request,
    `/api/admin/reconciliation-cases/${id}/acknowledge`,
    "admin",
  );
}
