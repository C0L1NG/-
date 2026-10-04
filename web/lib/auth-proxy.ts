import { createHash, createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { matchesRequestOrigin } from "./request-origin";

export function sameOrigin(request: NextRequest): boolean {
  return matchesRequestOrigin(
    request.headers.get("origin"),
    request.headers.get("host"),
    request.nextUrl.protocol,
    process.env.WEB_ORIGIN,
  );
}

export async function proxyMutation(
  request: NextRequest,
  path: string,
  role?: "agent" | "admin",
  login = false,
) {
  if (!sameOrigin(request))
    return NextResponse.json({ code: "INVALID_ORIGIN" }, { status: 403 });
  const isLogout = path.endsWith("/logout");
  const cookieName =
    role === "admin" ? "admin_access_token" : "agent_access_token";
  // Local logout must succeed even when upstream revocation is unavailable.
  // sessionRevoked describes the remote result; it never claims other sessions ended.
  const localLogout = (sessionRevoked: boolean) => {
    const response = NextResponse.json(
      { ok: true, sessionRevoked },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(cookieName, "", {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 0,
      secure: request.headers.get("origin")?.startsWith("https://") ?? false,
    });
    return response;
  };
  const base =
    role === "admin"
      ? (process.env.ADMIN_API_BASE_URL ?? process.env.AGENT_API_BASE_URL)
      : process.env.AGENT_API_BASE_URL;
  if (!base && isLogout) return localLogout(false);
  if (!base)
    return NextResponse.json({ code: "API_NOT_CONFIGURED" }, { status: 503 });
  const token = (await cookies()).get(cookieName)?.value;
  if (isLogout && !token) return localLogout(true);
  if (role && !login && !token)
    return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });
  const requestId = randomBytes(16).toString("hex");
  try {
    const body = await request.text();
    if (body.length > 8192)
      return NextResponse.json({ code: "PAYLOAD_TOO_LARGE" }, { status: 413 });
    const contextSecret = process.env.BFF_CONTEXT_SECRET;
    if (login && (!contextSecret || contextSecret.length < 32))
      return NextResponse.json(
        { code: "BFF_CONTEXT_NOT_CONFIGURED" },
        { status: 503 },
      );
    const existingClient = (await cookies()).get("rate_client")?.value;
    const client =
      existingClient && /^[a-f0-9]{64}$/.test(existingClient)
        ? existingClient
        : randomBytes(32).toString("hex");
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const canonical = [
      timestamp,
      "POST",
      path,
      client,
      createHash("sha256").update(body).digest("hex"),
    ].join("\n");
    const contextHeaders: Record<string, string> =
      contextSecret && contextSecret.length >= 32
        ? {
            "X-BFF-Client": client,
            "X-BFF-Timestamp": timestamp,
            "X-BFF-Signature": createHmac("sha256", contextSecret)
              .update(canonical)
              .digest("hex"),
          }
        : {};
    const setClient = (response: NextResponse) => {
      response.cookies.set("rate_client", client, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 86400,
        secure: request.headers.get("origin")?.startsWith("https://") ?? false,
      });
      return response;
    };
    const upstream = await fetch(new URL(path, base), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": requestId,
        ...contextHeaders,
        ...(token && !login ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body || undefined,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (upstream.status >= 300 && upstream.status < 400)
      throw new Error("Unexpected redirect");
    if (isLogout) return localLogout(upstream.ok || upstream.status === 401);
    const data = await upstream.json();
    if (login && upstream.ok) {
      if (
        typeof data.accessToken !== "string" ||
        typeof data.expiresIn !== "number" ||
        !["agent", "admin"].includes(data.role)
      )
        throw new Error("Invalid login response");
      // Tokens stay in HttpOnly cookies; they are not returned to browser JavaScript.
      const response = NextResponse.json(
        { ok: true, role: data.role },
        { headers: { "Cache-Control": "no-store", "X-Request-ID": requestId } },
      );
      response.cookies.set(
        data.role === "admin" ? "admin_access_token" : "agent_access_token",
        data.accessToken,
        {
          httpOnly: true,
          secure:
            request.headers.get("origin")?.startsWith("https://") ?? false,
          sameSite: "lax",
          path: "/",
          maxAge: data.expiresIn,
        },
      );
      response.cookies.delete(
        data.role === "admin" ? "agent_access_token" : "admin_access_token",
      );
      return setClient(response);
    }
    const response = NextResponse.json(data, {
      status: upstream.status,
      headers: {
        "Cache-Control": "no-store",
        ...(upstream.headers.get("x-request-id")
          ? { "X-Request-ID": upstream.headers.get("x-request-id")! }
          : {}),
      },
    });
    return setClient(response);
  } catch {
    if (isLogout) return localLogout(false);
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "服务暂时不可用，请重试" },
      { status: 502, headers: { "X-Request-ID": requestId } },
    );
  }
}
