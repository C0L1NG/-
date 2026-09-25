"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Activity, Home, ReceiptText, UserRound, RefreshCw, LockKeyhole } from "lucide-react";
import { AgentApiError, agentGet } from "@/lib/api";
import { demoOverview, demoReferral } from "@/lib/demo-data";
import type { Overview, Referral } from "@/lib/types";

type AgentContextValue = {
  demo: boolean; overview: Overview | null; referral: Referral | null; loading: boolean;
  hidden: boolean; setHidden: (value: boolean) => void;
  theme: "dark" | "light"; setTheme: (value: "dark" | "light") => void;
  notify: (message: string) => void; refresh: () => void;
};
const AgentContext = createContext<AgentContextValue | null>(null);
export function useAgent() {
  const context = useContext(AgentContext);
  if (!context) throw new Error("AgentShell is required");
  return context;
}

const tabs = [
  { href: "/agent/", label: "首页", icon: Home },
  { href: "/agent/progress/", label: "进展", icon: Activity },
  { href: "/agent/ledger/", label: "明细", icon: ReceiptText },
  { href: "/agent/profile/", label: "我的", icon: UserRound },
];

export function AgentShell({ children, demo = false }: { children: React.ReactNode; demo?: boolean }) {
  const pathname = usePathname();
  const [overview, setOverview] = useState<Overview | null>(demo ? demoOverview : null);
  const [referral, setReferral] = useState<Referral | null>(demo ? demoReferral : null);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [theme, setThemeState] = useState<"dark" | "light">("dark");
  const [toast, setToast] = useState("");

  useEffect(() => {
    const saved = window.localStorage.getItem("agent-theme");
    if (saved === "dark" || saved === "light") setThemeState(saved);
  }, []);
  const setTheme = useCallback((value: "dark" | "light") => {
    window.localStorage.setItem("agent-theme", value);
    setThemeState(value);
  }, []);
  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2700);
  }, []);
  const refresh = useCallback(() => { setError(""); setRevision((value) => value + 1); }, []);

  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    setLoading(true);
    Promise.all([
      agentGet<Overview>("/api/agent/overview", controller.signal),
      agentGet<Referral>("/api/agent/referral", controller.signal),
    ]).then(([nextOverview, nextReferral]) => {
      setOverview(nextOverview); setReferral(nextReferral); setError("");
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      setError(reason instanceof AgentApiError && reason.status === 401
        ? "需要微信授权登录后查看代理商账户。" : "账户数据暂时不可用，请重试。");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [demo, revision]);

  return <AgentContext.Provider value={{ demo, overview, referral, loading, hidden, setHidden, theme, setTheme, notify, refresh }}>
    <div className={"min-h-dvh bg-[#080D08] font-sans antialiased " + (theme === "dark" ? "agent-dark" : "agent-light")}>
      <div className="relative mx-auto min-h-dvh w-full max-w-[430px] overflow-x-hidden bg-[var(--agent-bg)] text-[var(--agent-text)] transition-colors duration-300">
        <main className="px-5 pb-[calc(116px+env(safe-area-inset-bottom))] pt-[max(30px,env(safe-area-inset-top))]">
          {demo && <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[var(--agent-line)] bg-[var(--agent-surface)] px-3 py-1.5 text-[10px] text-[var(--agent-muted)]"><span className="h-1.5 w-1.5 rounded-full bg-[#9FE870]" />公开演示 · 虚构数据</div>}
          {error && <div role="alert" className="mb-5 flex items-center gap-3 rounded-2xl border border-[var(--agent-line)] bg-[var(--agent-surface)] px-4 py-3 text-[12px] text-[var(--agent-muted)]"><LockKeyhole size={16} /><span className="flex-1">{error}</span><button type="button" onClick={refresh} aria-label="重试" className="rounded-full p-2 text-[var(--agent-text)]"><RefreshCw size={16} /></button></div>}
          {children}
        </main>
        <nav aria-label="代理商导航" className="fixed bottom-0 left-1/2 z-30 flex w-full max-w-[430px] -translate-x-1/2 justify-around border-t border-[var(--agent-line)] bg-[var(--agent-nav)] px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3.5 backdrop-blur-lg">
          {tabs.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname === href.slice(0, -1);
            return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={"flex w-[64px] flex-col items-center gap-1.5 rounded-2xl py-1 transition-colors " + (active ? "text-[#9FE870]" : "text-[var(--agent-muted)] hover:text-[var(--agent-text)]")}>
              <Icon size={21} strokeWidth={active ? 2 : 1.7} /><span className="text-[10px] font-semibold">{label}</span>
            </Link>;
          })}
        </nav>
        {toast && <div role="status" aria-live="polite" className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-full border border-[var(--agent-line)] bg-[var(--agent-surface-raised)] px-4 py-2.5 text-[12px] font-semibold text-[var(--agent-text)] shadow-[0_14px_40px_rgba(0,0,0,.25)]">{toast}</div>}
      </div>
    </div>
  </AgentContext.Provider>;
}
