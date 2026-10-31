"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  Home,
  ReceiptText,
  UserRound,
  RefreshCw,
  CircleAlert,
} from "lucide-react";
import { AgentApiError, agentGet } from "@/lib/api";
import { getDemoAgent, type DemoLevel, DEMO_NOW } from "@/lib/demo-data";
import { useResource } from "./use-resource";
import { useLiveRefresh } from "./live-refresh";
import type { Overview, Referral } from "@/lib/types";

type AgentContextValue = {
  demo: boolean;
  overview: Overview | null;
  referral: Referral | null;
  loading: boolean;
  hidden: boolean;
  setHidden: (value: boolean) => void;
  theme: "dark" | "light";
  setTheme: (value: "dark" | "light") => void;
  notify: (message: string) => void;
  refresh: () => void;
  revision: number;
  updatedAt: string | null;
  demoLevel: DemoLevel;
  setDemoLevel: (level: DemoLevel) => void;
  demoData: ReturnType<typeof getDemoAgent>;
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

export function AgentShell({
  children,
  demo = false,
}: {
  children: React.ReactNode;
  demo?: boolean;
}) {
  const pathname = usePathname();
  const [demoLevel, setDemoLevel] = useState<DemoLevel>("first");
  const demoData = useMemo(() => getDemoAgent(demoLevel), [demoLevel]);
  const { revision, refresh: triggerRefresh } = useLiveRefresh(!demo);
  const account = useResource<Overview>(
    demo ? null : "/api/agent/overview",
    revision,
    agentGet,
  );
  const promotion = useResource<Referral>(
    demo ? null : "/api/agent/referral",
    revision,
    agentGet,
  );
  const overview = account.data,
    referral = promotion.data;
  const loading = account.loading,
    updatedAt = account.updatedAt;
  const authDenied = [account.error, promotion.error].some(
    (reason) =>
      reason instanceof AgentApiError && [401, 403].includes(reason.status),
  );
  const failures = [
    account.error ? "账户概览暂时不可用" : "",
    promotion.error ? "推广信息暂时不可用" : "",
  ].filter(Boolean);
  const error = authDenied
    ? "登录状态或账户权限已变化，请重新登录。"
    : failures.length
      ? failures.join("；") + "。请重试；已有数据以标注的更新时间为准。"
      : "";
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
  const refresh = triggerRefresh;

  return (
    <AgentContext.Provider
      value={{
        demo,
        overview: demo ? demoData.overview : overview,
        referral: demo ? demoData.referral : referral,
        loading,
        hidden,
        setHidden,
        theme,
        setTheme,
        notify,
        refresh,
        revision,
        updatedAt: demo ? DEMO_NOW : updatedAt,
        demoLevel,
        setDemoLevel,
        demoData,
      }}
    >
      <div
        className={
          "partner-shell min-h-dvh bg-[var(--console-bg)] font-sans antialiased " +
          (theme === "dark" ? "agent-dark" : "agent-light")
        }
      >
        <div className="partner-phone relative mx-auto min-h-dvh w-full max-w-[430px] overflow-x-hidden bg-[var(--agent-bg)] text-[var(--agent-text)] transition-colors duration-300">
          <main className="px-5 pb-[calc(116px+env(safe-area-inset-bottom))] pt-[max(16px,env(safe-area-inset-top))]">
            {demo && (
              <div className="mb-5 flex items-center gap-2 text-[10px] tracking-wide text-[var(--agent-muted)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--action-bg)]" />
                公开演示 · 虚构数据
              </div>
            )}
            {error && (
              <div
                role="alert"
                className="mb-5 flex items-center gap-3 rounded-lg border border-[var(--agent-line)] bg-[var(--agent-surface)] px-4 py-3 text-[12px] text-[var(--agent-muted)]"
              >
                <CircleAlert size={16} />
                <span className="flex-1">{error}</span>
                <button
                  type="button"
                  onClick={refresh}
                  aria-label="重试"
                  className="rounded-full p-2 text-[var(--agent-text)]"
                >
                  <RefreshCw size={16} />
                </button>
              </div>
            )}
            {authDenied ? (
              <Link href="/login/" className="exchange-primary">
                重新登录
              </Link>
            ) : (
              children
            )}
          </main>
          <nav
            aria-label="代理商导航"
            className="partner-nav fixed bottom-0 left-1/2 z-30 flex w-full max-w-[430px] -translate-x-1/2 justify-around border-t border-[var(--agent-line)] bg-[var(--agent-nav)] px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3.5 backdrop-blur-lg"
          >
            {tabs.map(({ href, label, icon: Icon }) => {
              const active =
                pathname === href ||
                pathname === href.slice(0, -1) ||
                (href === "/agent/progress/" &&
                  pathname.startsWith("/agent/team")) ||
                (href === "/agent/profile/" &&
                  pathname.startsWith("/agent/withdrawals"));
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={
                    "flex w-[64px] flex-col items-center gap-1.5 rounded-lg py-1 transition-colors " +
                    (active
                      ? "text-[var(--agent-accent-text)]"
                      : "text-[var(--agent-muted)] hover:text-[var(--agent-text)]")
                  }
                >
                  <Icon size={21} strokeWidth={active ? 2 : 1.7} />
                  <span className="text-[12px] font-semibold">{label}</span>
                </Link>
              );
            })}
          </nav>
          {toast && (
            <div
              role="status"
              aria-live="polite"
              className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 max-w-[calc(100vw-32px)] w-max text-center rounded-lg border border-[var(--agent-line)] bg-[var(--agent-surface-raised)] px-4 py-2.5 text-[12px] font-semibold text-[var(--agent-text)] "
            >
              {toast}
            </div>
          )}
        </div>
      </div>
    </AgentContext.Provider>
  );
}
