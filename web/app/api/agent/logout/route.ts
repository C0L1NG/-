import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set("agent_access_token", "", { path: "/", httpOnly: true, sameSite: "lax", maxAge: 0 });
  return response;
}
