"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Download,
  LayoutGrid,
  Network,
  ReceiptText,
  Wallet,
  Search,
  LogOut,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { adminGet } from "@/lib/admin-api";
import {
  demoAdminOverview,
  demoAdminOverviewMonth,
} from "@/lib/admin-demo-data";
import type { AdminOverview, AuditPage } from "@/lib/admin-types";
import { Skeleton } from "./admin-dark-ui";
import { AdminNetwork } from "./admin-network";
import { AdminTreasury } from "./admin-treasury";
import { AdminAuditTable } from "./admin-audit-table";
import { exportAdminAudit } from "@/lib/admin-export";
import { filteredDemoAudit } from "@/lib/admin-filters";
import { displayAmount } from "@/lib/money";
import { AdminOperations, type TreasuryFocus } from "./admin-operations";
import { WalletSummary } from "./wallet-summary";
import { RefreshStatus, useLiveRefresh } from "./live-refresh";
import { DateFilter } from "./date-filter";
import type { DateBounds } from "@/lib/date-range";

type Workspace = "overview" | "network" | "audit" | "treasury";
const sections = [
  { id: "overview", label: "资金总览", Icon: LayoutGrid },
  { id: "network", label: "代理网络", Icon: Network },
  { id: "audit", label: "分账审计", Icon: ReceiptText },
  { id: "treasury", label: "资金管理", Icon: Wallet },
] as const;
const PAGE_SIZE = 8;
export function AdminDashboard({ demo = false }: { demo?: boolean }) {
  const [view, setView] = useState<Workspace>("overview");
  const [period, setPeriod] = useState<"all" | "month">("all");
  const [bounds, setBounds] = useState<DateBounds>({});
  const [overview, setOverview] = useState<AdminOverview | null>(
    demo ? demoAdminOverview : null,
  );
  const [audit, setAudit] = useState<AuditPage | null>(null);
  const [page, setPage] = useState(1),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState("");
  const { revision, refresh: retry } = useLiveRefresh(!demo);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null),
    [auditAt, setAuditAt] = useState<string | null>(null);
  const [treasuryFocus, setTreasuryFocus] = useState<TreasuryFocus>();
  const [exporting, setExporting] = useState(false),
    [message, setMessage] = useState("");
  const [overviewLoading, setOverviewLoading] = useState(!demo),
    [auditLoading, setAuditLoading] = useState(!demo);
  const [overviewError, setOverviewError] = useState(""),
    [auditError, setAuditError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [twoLevel, setTwoLevel] = useState(true);
  const auditFilters =
    view === "audit" ? { q: search, ...bounds } : { period, q: search };
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    setPage(1);
  }, [period, bounds, revision]);
  useEffect(() => {
    if (demo) {
      setOverview(
        period === "month" ? demoAdminOverviewMonth : demoAdminOverview,
      );
      return;
    }
    const controller = new AbortController();
    setOverviewLoading(true);
    setOverviewError("");
    adminGet<AdminOverview>(
      `/api/admin/overview?period=${period}`,
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted) {
          setOverview(value);
          setUpdatedAt(new Date().toISOString());
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setOverviewError("资金数据暂时不可用");
      })
      .finally(() => {
        if (!controller.signal.aborted) setOverviewLoading(false);
      });
    return () => controller.abort();
  }, [demo, period, revision]);
  useEffect(() => {
    if (demo) {
      const items = filteredDemoAudit(auditFilters);
      setAudit({
        items: items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
        page,
        pageSize: PAGE_SIZE,
        total: items.length,
        totalPages: Math.ceil(items.length / PAGE_SIZE),
      });
      return;
    }
    const controller = new AbortController();
    setAuditLoading(true);
    setAuditError("");
    adminGet<AuditPage>(
      "/api/admin/commission-audit?" +
        new URLSearchParams(
          Object.entries({
            ...auditFilters,
            page: String(page),
            pageSize: String(PAGE_SIZE),
          }).filter(([, value]) => value !== undefined) as [string, string][],
        ),
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted) {
          setAudit(value);
          setAuditAt(new Date().toISOString());
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setAuditError("审计流水暂时不可用");
      })
      .finally(() => {
        if (!controller.signal.aborted) setAuditLoading(false);
      });
    return () => controller.abort();
  }, [demo, period, page, search, revision, bounds, view]);
  async function download() {
    if (exporting) return;
    setExporting(true);
    setMessage("");
    try {
      const count = await exportAdminAudit(demo, auditFilters);
      setMessage(
        count === null ? "对账文件已生成" : `已导出 ${count} 笔演示订单`,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "导出失败，请重试");
    } finally {
      setExporting(false);
    }
  }
  async function logout() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const response = await fetch("/api/auth/admin/logout", {
        method: "POST",
      });
      if (!response.ok) throw new Error();
      window.location.replace("/login/");
    } catch {
      setMessage("退出失败，请重试");
      setSigningOut(false);
    }
  }
  function switchView(next: Workspace) {
    if (next === view) return;
    setView(next);
    setPage(1);
    setBounds({});
    setMessage("");
  }
  const errorPanel = (error: string) => (
    <p
      role="alert"
      className="rounded-lg border border-[#333] bg-[#151515] p-5 text-sm text-[#B3B3B3]"
    >
      {error}
      <button className="ml-4 underline" onClick={retry}>
        重试
      </button>
      <Link href="/login/" className="ml-4 underline">
        重新登录
      </Link>
    </p>
  );
  const title = sections.find((s) => s.id === view)!.label;
  const auditSection = (
    <section aria-label="全网分账审计" className="min-w-0">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">
            {view === "overview" ? "最新分账" : "订单分账记录"}
          </h2>
          <p className="mt-1.5 text-xs text-[#909090]">
            共 {audit?.total ?? "—"} 笔 · 原始入账与退款状态逐笔核对
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 rounded-lg border border-[#303030] bg-[#161616] px-3">
            <Search size={16} className="text-[#929292]" />
            <input
              aria-label="搜索订单或出单人"
              maxLength={80}
              placeholder="订单号 / 出单人"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-10 w-44 bg-transparent text-sm outline-none"
            />
          </label>
          <button
            className="exchange-secondary"
            disabled={exporting || auditLoading || query.trim() !== search}
            onClick={download}
          >
            <Download size={15} />
            {exporting ? "正在导出…" : "导出对账"}
          </button>
          {view === "overview" && (
            <button
              onClick={() => switchView("audit")}
              aria-label="查看全部审计"
              className="flex h-11 w-11 items-center justify-center rounded-lg border border-[#303030]"
            >
              <ArrowUpRight size={18} />
            </button>
          )}
        </div>
      </div>
      {view === "audit" && (
        <div className="mb-4">
          <DateFilter demo={demo} onChange={setBounds} />
        </div>
      )}
      {auditError ? (
        errorPanel(auditError)
      ) : auditLoading ? (
        <Skeleton className="h-60 w-full" />
      ) : audit?.items.length ? (
        <AdminAuditTable
          items={view === "overview" ? audit.items.slice(0, 4) : audit.items}
        />
      ) : (
        <p className="rounded-lg border border-[#262626] py-14 text-center text-sm text-[#929292]">
          当前条件下暂无订单
        </p>
      )}
      {view === "audit" && audit && audit.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-4 text-sm">
          <button
            disabled={page === 1 || auditLoading}
            onClick={() => setPage((p) => p - 1)}
            className="exchange-secondary"
          >
            上一页
          </button>
          <span className="font-mono text-[#929292]">
            {page} / {audit.totalPages}
          </span>
          <button
            disabled={page >= audit.totalPages || auditLoading}
            onClick={() => setPage((p) => p + 1)}
            className="exchange-secondary"
          >
            下一页
          </button>
        </div>
      )}
    </section>
  );
  return (
    <div className="min-h-dvh bg-[#0A0A0A] text-[#F5F5F5]">
      <header className="sticky top-0 z-30 border-b border-[#262626] bg-[#090909]/95 backdrop-blur-md">
        <div className="mx-auto flex min-h-16 max-w-[1680px] items-center justify-between gap-4 px-6 lg:px-10">
          <div className="flex items-center gap-4">
            <span className="text-xl font-bold tracking-[-.06em]">
              CONSOLE<span className="ml-1 text-[#C5FF59]">▰</span>
            </span>
            <span className="hidden border-l border-[#343434] pl-4 text-xs text-[#949494] sm:block">
              分润平台 · 管理中心
            </span>
          </div>
          <div className="flex items-center gap-5 text-xs text-[#AAA]">
            <Link
              href="/admin/mobile/"
              className="flex min-h-10 items-center gap-1.5"
            >
              <Smartphone size={15} />
              手机版
            </Link>
            {demo ? (
              <span className="rounded border border-[#3A3A3A] px-2 py-1 font-mono">
                DEMO
              </span>
            ) : (
              <button
                disabled={signingOut}
                onClick={logout}
                className="flex items-center gap-2"
              >
                <LogOut size={14} />
                {signingOut ? "退出中…" : "退出"}
              </button>
            )}
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#262626] text-xs font-semibold text-white">
              老板
            </span>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-[1680px] px-6 pb-10 lg:px-10">
        <nav
          aria-label="老板工作区导航"
          className="flex gap-8 overflow-x-auto border-b border-[#262626]"
        >
          {sections.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={view === id ? "page" : undefined}
              onClick={() => switchView(id)}
              className="exchange-tab flex items-center gap-2"
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>
        <div className="mb-7 mt-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs text-[#787878]">
              管理中心 <span className="mx-2">/</span> {title}
            </p>
            <h1 className="mt-2 text-[28px] font-semibold tracking-tight">
              {title}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            <RefreshStatus
              demo={demo}
              at={view === "audit" ? auditAt : updatedAt}
              busy={overviewLoading || auditLoading}
              onRefresh={retry}
            />
            {(view === "overview" || view === "network") && (
              <select
                aria-label="统计周期"
                value={period}
                onChange={(e) => {
                  setPeriod(e.target.value as "all" | "month");
                  setBounds({});
                }}
                className="h-10 rounded-lg border border-[#333] bg-[#161616] px-3 text-sm"
              >
                <option value="all">全周期</option>
                <option value="month">本月 · UTC</option>
              </select>
            )}
          </div>
        </div>
        {message && (
          <p
            role="status"
            aria-live="polite"
            className="mb-5 rounded-lg border border-[#333] bg-[#181818] px-4 py-3 text-sm"
          >
            {message}
          </p>
        )}
        {view === "overview" && (
          <>
            {overviewError ? (
              errorPanel(overviewError)
            ) : (
              <section className="grid border-y border-[#262626] lg:grid-cols-[1.25fr_1.75fr]">
                <article className="py-7 lg:border-r lg:border-[#262626] lg:pr-10">
                  <div className="flex items-center gap-3 text-sm text-[#999]">
                    平台净收益
                    <span className="rounded border border-[#353535] px-1.5 py-0.5 font-mono text-[11px] text-white">
                      30%
                    </span>
                  </div>
                  {overviewLoading ? (
                    <Skeleton className="mt-5 h-14 w-64" />
                  ) : (
                    <p className="financial-number mt-4 font-mono text-[clamp(28px,3.2vw,49px)] font-semibold">
                      {displayAmount(overview?.platformTotalRevenue)}
                    </p>
                  )}
                  <p className="mt-3 flex items-center gap-1.5 text-xs text-[#929292]">
                    <ShieldCheck size={13} className="text-[var(--positive)]" />
                    已扣除退款冲正 ·{" "}
                    {period === "all" ? "累计净收益" : "本月净收益"}
                  </p>
                  <button
                    className="mt-6 flex min-h-9 items-center gap-2 text-sm font-medium"
                    onClick={() => switchView("treasury")}
                  >
                    管理资金与提现
                    <ArrowUpRight size={16} />
                  </button>
                </article>
                <div className="grid grid-cols-1 sm:grid-cols-3 lg:pl-8">
                  {[
                    {
                      label: "全网净成交 GMV",
                      value: displayAmount(overview?.totalGmv),
                      detail: "支付减退款",
                    },
                    {
                      label: "代理净分成",
                      value: displayAmount(overview?.agentCommissionPool),
                      detail: "70% 奖金池",
                    },
                    {
                      label: "网络合伙人",
                      value: overview ? String(overview.agentCount) : "—",
                      detail: "一级 + 二级",
                    },
                  ].map((metric) => (
                    <article
                      key={metric.label}
                      className="min-w-0 py-7 sm:px-4"
                    >
                      <p className="text-sm text-[#999]">{metric.label}</p>
                      {overviewLoading ? (
                        <Skeleton className="mt-7 h-8 w-full" />
                      ) : (
                        <p className="financial-number mt-7 font-mono text-[clamp(17px,1.6vw,28px)] font-semibold">
                          {metric.value}
                        </p>
                      )}
                      <p className="mt-3 text-xs text-[#787878]">
                        {metric.detail}
                      </p>
                    </article>
                  ))}
                </div>
              </section>
            )}
            <div className="my-7 grid items-stretch gap-5 lg:grid-cols-[1fr_1fr]">
              <WalletSummary demo={demo} revision={revision} />
              <section
                aria-label="分润规则"
                className="rounded-lg border border-[#262626] bg-[#101010] p-5"
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-medium">分润规则</h2>
                  <div className="flex gap-3 text-xs">
                    <button
                      aria-pressed={twoLevel}
                      onClick={() => setTwoLevel(true)}
                      className={
                        twoLevel
                          ? "text-white underline underline-offset-4"
                          : "text-[#777]"
                      }
                    >
                      两级订单
                    </button>
                    <button
                      aria-pressed={!twoLevel}
                      onClick={() => setTwoLevel(false)}
                      className={
                        !twoLevel
                          ? "text-white underline underline-offset-4"
                          : "text-[#777]"
                      }
                    >
                      直推订单
                    </button>
                  </div>
                </div>
                <div
                  className="mt-6 flex h-2 gap-1 overflow-hidden rounded-sm"
                  aria-hidden="true"
                >
                  <span className="w-[30%] bg-[#EBEBEB]" />
                  <span
                    style={{ width: twoLevel ? "49%" : "70%" }}
                    className="bg-[#757575]"
                  />
                  {twoLevel && <span className="w-[21%] bg-[#C5FF59]" />}
                </div>
                <div className="mt-4 flex flex-wrap justify-between gap-3 text-xs text-[#999]">
                  <span>
                    平台留存{" "}
                    <strong className="ml-1 font-mono text-white">30%</strong>
                  </span>
                  <span>
                    出单代理{" "}
                    <strong className="ml-1 font-mono text-white">
                      {twoLevel ? 49 : 70}%
                    </strong>
                  </span>
                  {twoLevel && (
                    <span>
                      直属导师{" "}
                      <strong className="ml-1 font-mono text-white">21%</strong>
                    </span>
                  )}
                </div>
                <p className="mt-4 text-[11px] text-[#777]">
                  按订单利润分配，尾差按结算规则处理。
                </p>
              </section>
            </div>
            <AdminOperations
              demo={demo}
              refreshKey={revision}
              onSelect={(focus) => {
                setTreasuryFocus(focus);
                setView("treasury");
              }}
            />
            <div className="mt-8">{auditSection}</div>
          </>
        )}
        {view === "network" && (
          <AdminNetwork demo={demo} period={period} refreshKey={revision} />
        )}
        {view === "audit" && auditSection}
        {view === "treasury" && (
          <div className="space-y-6">
            <WalletSummary demo={demo} revision={revision} />
            <AdminOperations
              demo={demo}
              refreshKey={revision}
              onSelect={setTreasuryFocus}
            />
            <AdminTreasury
              demo={demo}
              focus={treasuryFocus}
              onComplete={retry}
            />
          </div>
        )}
        <footer className="mt-10 flex flex-wrap justify-between gap-3 border-t border-[#222] pt-5 text-[11px] text-[#707070]">
          <span>CONSOLE / 二级分润 · 平台统一结算</span>
          <span>
            {demo
              ? "演示快照 2026-10-03 · 虚构数据"
              : "财务时间 UTC · 页面可见时每分钟更新"}
          </span>
        </footer>
      </div>
    </div>
  );
}
