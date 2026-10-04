import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

type AgentResource =
  | "overview"
  | "referral"
  | "ledger"
  | "activity"
  | "activity-summary"
  | "team"
  | "mini-program-code"
  | "progress"
  | "payout-accounts"
  | "withdrawals"
  | "wallet";
type AdminResource =
  | "operations-summary"
  | "payment-events"
  | "overview"
  | "team-tree"
  | "commission-audit"
  | "team-network"
  | "commission-export"
  | "payout-accounts/pending"
  | `withdrawals/${string}/payout-details`
  | "payout-accounts"
  | "withdrawals"
  | "wallet";

export async function proxyAgentGet(
  resource: AgentResource,
  request: NextRequest,
) {
  const token = (await cookies()).get("agent_access_token")?.value;
  if (!token) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Agent session is required" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const base = process.env.AGENT_API_BASE_URL;
  if (!base) {
    return NextResponse.json(
      { code: "API_NOT_CONFIGURED" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const upstream = new URL(`/api/agent/${resource}`, base);
  upstream.search = request.nextUrl.search;

  try {
    const response = await fetch(upstream, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "X-Request-ID": randomBytes(16).toString("hex"),
      },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status >= 300 && response.status < 400) {
      return NextResponse.json(
        { code: "UPSTREAM_REDIRECT_REJECTED" },
        { status: 502 },
      );
    }
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") ??
          "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...(response.headers.get("x-request-id")
          ? { "X-Request-ID": response.headers.get("x-request-id")! }
          : {}),
      },
    });
  } catch {
    return NextResponse.json(
      { code: "AGENT_API_UNAVAILABLE" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function proxyAdminGet(
  resource: AdminResource,
  request: NextRequest,
) {
  const token = (await cookies()).get("admin_access_token")?.value;
  if (!token)
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Admin session is required" },
      { status: 401 },
    );
  const base = process.env.ADMIN_API_BASE_URL ?? process.env.AGENT_API_BASE_URL;
  if (!base)
    return NextResponse.json({ code: "API_NOT_CONFIGURED" }, { status: 503 });
  const upstream = new URL(`/api/admin/${resource}`, base);
  upstream.search = request.nextUrl.search;
  try {
    const response = await fetch(upstream, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "X-Request-ID": randomBytes(16).toString("hex"),
      },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(
        resource === "commission-export" ? 300_000 : 10_000,
      ),
    });
    if (response.status >= 300 && response.status < 400)
      return NextResponse.json(
        { code: "UPSTREAM_REDIRECT_REJECTED" },
        { status: 502 },
      );
    return new NextResponse(
      resource === "commission-export" ? response.body : await response.text(),
      {
        status: response.status,
        headers: {
          "Content-Type":
            response.headers.get("content-type") ?? "application/json",
          "Cache-Control": "no-store",
          ...(response.headers.get("x-request-id")
            ? { "X-Request-ID": response.headers.get("x-request-id")! }
            : {}),
          ...(response.headers.get("content-disposition")
            ? {
                "Content-Disposition": response.headers.get(
                  "content-disposition",
                )!,
              }
            : {}),
        },
      },
    );
  } catch {
    return NextResponse.json(
      { code: "ADMIN_API_UNAVAILABLE" },
      { status: 502 },
    );
  }
}
