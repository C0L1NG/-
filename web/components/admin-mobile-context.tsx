"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Network, RefreshCw, ShieldCheck } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { adminGet } from "@/lib/admin-api";
import { demoAdminOverview, demoAdminOverviewDay } from "@/lib/admin-demo-data";
import type { AdminOverview } from "@/lib/admin-types";
import { useLiveRefresh } from "./live-refresh";

type Context = {
  demo: boolean;
  all: AdminOverview | null;
  day: AdminOverview | null;
  loading: boolean;
  refresh: () => void;
  notify: (message: string) => void;
  revision: number;
  updatedAt: string | null;
};
const AdminMobileContext = createContext<Context | null>(null);
export function useAdminMobile() {
  const value = useContext(AdminMobileContext);
  if (!value) throw new Error("AdminMobileShell is required");
  return value;
}
const tabs = [
  { href: "/admin/mobile/", label: "大盘", icon: BarChart3 },
  { href: "/admin/mobile/team/", label: "团队", icon: Network },
  { href: "/admin/mobile/audit/", label: "审计", icon: ShieldCheck },
];

export function AdminMobileShell({
  children,
  demo = false,
}: {
  children: React.ReactNode;
  demo?: boolean;
}) {
  const pathname = usePathname();
  const [all, setAll] = useState<AdminOverview | null>(
    demo ? demoAdminOverview : null,
  );
  const [day, setDay] = useState<AdminOverview | null>(
    demo ? demoAdminOverviewDay : null,
  );
  const [loading, setLoading] = useState(!demo),
    [error, setError] = useState(""),
    [toast, setToast] = useState("");
  const { revision, refresh: triggerRefresh } = useLiveRefresh(!demo);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const refresh = useCallback(() => {
    setError("");
    triggerRefresh();
  }, [triggerRefresh]);
  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2700);
  }, []);
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    setLoading(true);
    Promise.all([
      adminGet<AdminOverview>(
        "/api/admin/overview?period=all",
        controller.signal,
      ),
      adminGet<AdminOverview>(
        "/api/admin/overview?period=day",
        controller.signal,
      ),
    ])
      .then(([total, today]) => {
        if (controller.signal.aborted) return;
        setAll(total);
        setDay(today);
        setUpdatedAt(new Date().toISOString());
        setError("");
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("管理员数据暂时不可用，请检查登录会话。");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [demo, revision]);

  return (
    <AdminMobileContext.Provider
      value={{ demo, all, day, loading, refresh, notify, revision, updatedAt }}
    >
      <div className="min-h-dvh bg-[#050505] font-sans text-[#F5F5F5] antialiased">
        <div className="relative mx-auto min-h-dvh w-full max-w-[430px] overflow-x-hidden bg-[#0A0A0A]">
          <main className="px-5 pb-[calc(112px+env(safe-area-inset-bottom))] pt-[max(16px,env(safe-area-inset-top))]">
            {demo && (
              <span className="mb-4 flex items-center gap-2 border-b border-[#262626] pb-3 text-[11px] text-[#929292]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--action-bg)]" />
                公开演示 · 虚构数据
              </span>
            )}
            {error && (
              <button
                type="button"
                role="alert"
                onClick={refresh}
                className="mb-5 flex w-full items-center gap-2 rounded-lg border border-white/[0.08] bg-[#121212] px-4 py-3 text-left text-[11px] text-[#BBBBBB]"
              >
                <span className="flex-1">{error}</span>
                <RefreshCw size={15} />
              </button>
            )}
            {error &&
            !pathname.includes("team") &&
            !pathname.includes("audit") ? (
              <Link href="/login/" className="text-[var(--positive)]">
                重新登录
              </Link>
            ) : (
              children
            )}
          </main>
          <nav
            aria-label="老板移动端导航"
            className="fixed bottom-0 left-1/2 z-30 flex w-full max-w-[430px] -translate-x-1/2 justify-around border-t border-white/[0.08] bg-[#0A0A0A]/85 px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-lg"
          >
            {tabs.map(({ href, label, icon: Icon }) => {
              const active =
                pathname === href ||
                pathname === href.slice(0, -1) ||
                (href === "/admin/mobile/" &&
                  pathname.startsWith("/admin/mobile/treasury"));
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={
                    "flex w-20 flex-col items-center gap-1.5 rounded-lg py-1 text-xs font-semibold " +
                    (active ? "text-white" : "text-[#929292]")
                  }
                >
                  <Icon size={21} strokeWidth={active ? 2 : 1.6} />
                  {label}
                </Link>
              );
            })}
          </nav>
          {toast && (
            <div
              role="status"
              aria-live="polite"
              className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 max-w-[calc(100vw-32px)] w-max text-center rounded-lg border border-white/[0.08] bg-[#242424] px-4 py-2.5 text-[12px] text-[#F5F5F5]"
            >
              {toast}
            </div>
          )}
        </div>
      </div>
    </AdminMobileContext.Provider>
  );
}
