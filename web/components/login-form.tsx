"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";

export function LoginForm() {
  const [next, setNext] = useState("/admin/pc/");
  const [role, setRole] = useState<"admin" | "agent">("admin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [ticket, setTicket] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const value = params.get("ticket");
    if (params.get("next") === "/admin/mobile/") setNext("/admin/mobile/");
    if (value) {
      setRole("agent");
      setTicket(value);
      window.history.replaceState(null, "", "/login/");
    }
  }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        role === "admin" ? "/api/auth/admin/login" : "/api/auth/web/exchange",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            role === "admin"
              ? { username, password }
              : { ticket: ticket.trim() },
          ),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.message ||
            (role === "admin"
              ? "登录失败，请检查账号密码"
              : "登录码已过期，请在小程序重新生成"),
        );
      window.location.replace(result.role === "admin" ? next : "/agent/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }
  const field =
    "mt-2 w-full rounded-lg border border-white/10 bg-[#0A0A0A] px-4 py-3 text-[#F5F5F5] outline-none focus:border-[var(--positive)]";
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#0A0A0A] px-5 text-[#F5F5F5]">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-xl border border-white/10 bg-[#121212] p-8"
      >
        <ShieldCheck className="text-[var(--positive)]" size={28} />
        <h1 className="mt-5 text-2xl font-bold">登录你的账户</h1>
        <div className="my-6 flex rounded-full bg-[#0A0A0A] p-1">
          {(["admin", "agent"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={role === value}
              onClick={() => setRole(value)}
              className={
                "flex-1 rounded-full py-2 text-sm " +
                (role === value
                  ? "bg-[var(--action-bg)] font-bold text-[var(--action-text)]"
                  : "text-[#929292]")
              }
            >
              {value === "admin" ? "老板总控" : "微信网页登录"}
            </button>
          ))}
        </div>
        {role === "admin" ? (
          <>
            <label className="block text-sm text-[#929292]">
              管理员账号
              <input
                required
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={field}
                maxLength={80}
              />
            </label>
            <label className="mt-4 block text-sm text-[#929292]">
              密码
              <input
                required
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={field}
                maxLength={512}
              />
            </label>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm leading-6 text-[#929292]">
              在代理小程序“我的”或老板小程序中生成网页登录码。登录码仅能使用一次，60
              秒内有效。
            </p>
            <label className="block text-sm text-[#929292]">
              网页登录码
              <input
                required
                autoComplete="off"
                value={ticket}
                onChange={(e) => setTicket(e.target.value)}
                className={field + " font-mono"}
              />
            </label>
          </>
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm text-[var(--positive)]">
            {error}
          </p>
        )}
        <button
          disabled={busy}
          className="mt-6 h-12 w-full rounded-full bg-[var(--action-bg)] font-bold text-[var(--action-text)] disabled:opacity-50"
        >
          {busy ? "正在登录…" : "登录"}
        </button>
        <a
          href="/demo/"
          className="mt-5 block text-center text-sm text-[#929292]"
        >
          查看公开演示
        </a>
      </form>
    </main>
  );
}
