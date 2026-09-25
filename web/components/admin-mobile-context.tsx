"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Network, RefreshCw, ShieldCheck } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { adminGet } from "@/lib/admin-api";
import { demoAdminOverview, demoAdminOverviewDay, demoTeamTreeMonth } from "@/lib/admin-demo-data";
import type { AdminOverview, TeamTree } from "@/lib/admin-types";

type Context = { demo: boolean; all: AdminOverview | null; day: AdminOverview | null; monthTree: TeamTree | null;
  loading: boolean; refresh: () => void; notify: (message: string) => void };
const AdminMobileContext = createContext<Context | null>(null);
export function useAdminMobile() { const value = useContext(AdminMobileContext); if (!value) throw new Error("AdminMobileShell is required"); return value; }
const tabs = [
  { href: "/admin/mobile/", label: "大盘", icon: BarChart3 },
  { href: "/admin/mobile/team/", label: "团队", icon: Network },
  { href: "/admin/mobile/audit/", label: "审计", icon: ShieldCheck },
];

export function AdminMobileShell({ children, demo = false }: { children: React.ReactNode; demo?: boolean }) {
  const pathname = usePathname();
  const [all, setAll] = useState<AdminOverview | null>(demo ? demoAdminOverview : null);
  const [day, setDay] = useState<AdminOverview | null>(demo ? demoAdminOverviewDay : null);
  const [monthTree, setMonthTree] = useState<TeamTree | null>(demo ? demoTeamTreeMonth : null);
  const [loading, setLoading] = useState(!demo), [error, setError] = useState(""), [revision, setRevision] = useState(0), [toast, setToast] = useState("");
  const refresh = useCallback(() => { setError(""); setRevision((value) => value + 1); }, []);
  const notify = useCallback((message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2700); }, []);
  useEffect(() => { if (demo) return; const timer = window.setInterval(() => setRevision((value) => value + 1), 60_000); return () => window.clearInterval(timer); }, [demo]);
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController(); setLoading(true);
    Promise.all([
      adminGet<AdminOverview>("/api/admin/overview?period=all", controller.signal),
      adminGet<AdminOverview>("/api/admin/overview?period=day", controller.signal),
      adminGet<TeamTree>("/api/admin/team-tree?period=month", controller.signal),
    ]).then(([total, today, tree]) => { setAll(total); setDay(today); setMonthTree(tree); setError(""); })
      .catch(() => { if (!controller.signal.aborted) setError("管理员数据暂时不可用，请检查登录会话。"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [demo, revision]);

  return <AdminMobileContext.Provider value={{ demo, all, day, monthTree, loading, refresh, notify }}>
    <div className="min-h-dvh bg-[#070B07] font-sans text-[#F4F5F0] antialiased"><div className="relative mx-auto min-h-dvh w-full max-w-md overflow-x-hidden bg-[#0D140C]"><main className="px-5 pb-[calc(112px+env(safe-area-inset-bottom))] pt-[max(28px,env(safe-area-inset-top))]">
      {demo && <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-[#141C13] px-3 py-1.5 text-[10px] text-[#8E9B8A]"><span className="h-1.5 w-1.5 rounded-full bg-[#9FE870]" />公开演示 · 虚构数据</span>}
      {error && <button type="button" role="alert" onClick={refresh} className="mb-5 flex w-full items-center gap-2 rounded-2xl border border-white/[0.08] bg-[#141C13] px-4 py-3 text-left text-[11px] text-[#B5C4AD]"><span className="flex-1">{error}</span><RefreshCw size={15} /></button>}
      {children}
    </main><nav aria-label="老板移动端导航" className="fixed bottom-0 left-1/2 z-30 flex w-full max-w-md -translate-x-1/2 justify-around border-t border-white/[0.08] bg-[#0D140C]/85 px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-lg">{tabs.map(({ href, label, icon: Icon }) => { const active = pathname === href || pathname === href.slice(0, -1); return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={"flex w-20 flex-col items-center gap-1.5 rounded-2xl py-1 text-[10px] font-semibold " + (active ? "text-[#9FE870]" : "text-[#8E9B8A]")}><Icon size={21} strokeWidth={active ? 2 : 1.6} />{label}</Link>; })}</nav>
      {toast && <div role="status" aria-live="polite" className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/[0.08] bg-[#21301E] px-4 py-2.5 text-[12px] text-[#F4F5F0]">{toast}</div>}
    </div></div>
  </AdminMobileContext.Provider>;
}
