"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Search, UsersRound } from "lucide-react";
import { Sheet } from "./agent-ui";
import { adminGet } from "@/lib/admin-api";
import type { NetworkNode, NetworkPage } from "@/lib/api-contract.generated";
import { demoNetworkNodes } from "@/lib/admin-demo-data";
import { formatMoney } from "@/lib/money";

const card = "rounded-xl border border-white/[0.08] bg-[#121212]";
const control =
  "rounded-full border border-white/10 px-4 py-2 text-sm text-[#C5C5C5] disabled:opacity-30";

function Children({
  node,
  period,
  demo,
  refreshKey,
}: {
  node: NetworkNode;
  period: string;
  demo: boolean;
  refreshKey: number;
}) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<NetworkPage | null>(null);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    adminGet<NetworkPage>(
      `/api/admin/team-network?period=${period}&parentId=${node.id}&page=${page}&pageSize=20`,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("二级团队暂时不可用");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [node.id, period, page, demo, retry, refreshKey]);
  const items = demo ? node.children : (data?.items ?? []);
  return (
    <div className="border-t border-white/5 px-5 py-5">
      <p className="mb-4 text-xs text-[#929292]">
        直属二级 · 21% 奖励仅流向该导师
      </p>
      {error ? (
        <button className={control} onClick={() => setRetry((x) => x + 1)}>
          {error} · 重试
        </button>
      ) : loading ? (
        <p className="text-sm text-[#929292]">正在加载团队…</p>
      ) : (
        <div className="ml-3 space-y-2 border-l border-[#343434] pl-4">
          {items.map((child) => (
            <div
              key={child.id}
              className="flex flex-wrap items-center gap-3 rounded-lg bg-[#0D0D0D] p-4"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-xs">
                {child.displayName.slice(0, 2)}
              </span>
              <span className="min-w-0 flex-1">
                <strong className="block text-sm">{child.displayName}</strong>
                <span className="mt-1 block text-xs text-[#929292]">
                  {child.ownOrderCount} 笔 · GMV ¥{formatMoney(child.ownGmv)}
                </span>
              </span>
              <span className="text-right text-xs text-[#929292]">
                导师奖励
                <strong className="mt-1 block font-mono text-sm text-[var(--positive)]">
                  ¥{formatMoney(child.mentorPaidUp)}
                </strong>
              </span>
            </div>
          ))}
          {!items.length && (
            <p className="text-sm text-[#929292]">暂无直属成员</p>
          )}
        </div>
      )}
      {!demo && (data?.totalPages ?? 0) > 1 && (
        <div className="mt-4 flex items-center justify-end gap-3">
          <button
            className={control}
            disabled={loading || page === 1}
            onClick={() => setPage((x) => x - 1)}
          >
            上一页
          </button>
          <span className="font-mono text-xs">
            {page}/{data?.totalPages}
          </span>
          <button
            className={control}
            disabled={loading || page >= (data?.totalPages ?? 1)}
            onClick={() => setPage((x) => x + 1)}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}

export function AdminNetwork({
  demo = false,
  period = "month",
  mobile = false,
  refreshKey = 0,
}: {
  demo?: boolean;
  period?: "all" | "month";
  mobile?: boolean;
  refreshKey?: number;
}) {
  const [data, setData] = useState<NetworkPage | null>(null);
  const [page, setPage] = useState(1),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null),
    [selected, setSelected] = useState<NetworkNode | null>(null);
  const [loading, setLoading] = useState(!demo),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    setPage(1);
    setOpen(null);
    setSelected(null);
  }, [period]);
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setSelected(null);
    const params = new URLSearchParams({
      period,
      page: String(page),
      pageSize: "20",
      q: search,
    });
    adminGet<NetworkPage>(
      "/api/admin/team-network?" + params,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("团队网络暂时不可用，请检查登录或重试");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [demo, period, page, search, retry, refreshKey]);
  const nodes = demo
    ? demoNetworkNodes(period).filter(
        (x) =>
          !search ||
          x.displayName.includes(search) ||
          (x.referralCode ?? "").includes(search),
      )
    : (data?.items ?? []);
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs tracking-widest text-[#929292]">NETWORK</p>
          <h2 className="mt-2 text-xl font-semibold">代理网络</h2>
          <p className="mt-2 text-sm text-[#929292]">
            {period === "month" ? "本月 · UTC" : "全周期"} · 按平台贡献排序
          </p>
        </div>
        <label className="flex items-center gap-2 rounded-full border border-white/10 bg-[#121212] px-4 py-2">
          <Search size={16} className="text-[#929292]" />
          <input
            aria-label="搜索一级代理"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="昵称或邀请码"
            maxLength={80}
            className="w-40 bg-transparent text-sm outline-none"
          />
        </label>
      </div>
      {error ? (
        <div role="alert" className={card + " p-6 text-sm text-[#929292]"}>
          {error}
          <button
            className={control + " ml-4"}
            onClick={() => setRetry((x) => x + 1)}
          >
            重试
          </button>
          <a href="/login/" className="ml-4 text-[var(--positive)]">
            登录
          </a>
        </div>
      ) : loading ? (
        <div className={card + " animate-pulse p-12 text-sm text-[#929292]"}>
          正在加载…
        </div>
      ) : (
        <div
          className={
            mobile
              ? "space-y-3"
              : "grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(270px,1fr)]"
          }
        >
          <div className="space-y-3">
            {nodes.map((node, index) => (
              <article key={node.id} className={card}>
                <div className="p-5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#242424] font-bold text-[var(--positive)]">
                      {node.displayName.slice(0, 2)}
                    </span>
                    <button
                      onClick={() => setSelected(node)}
                      aria-label={"查看" + node.displayName + "的代理详情"}
                      className="min-w-0 flex-1 text-left"
                    >
                      <strong className="block truncate">
                        {node.displayName}
                      </strong>
                      <span className="mt-1 block font-mono text-xs text-[#929292]">
                        {node.referralCode}
                      </span>
                    </button>
                    <span className="font-mono text-xs text-[var(--positive)]">
                      #{(page - 1) * 20 + index + 1}
                    </span>
                    <button
                      aria-expanded={open === node.id}
                      aria-label={
                        (open === node.id ? "收起" : "展开") +
                        node.displayName +
                        "的直属团队"
                      }
                      disabled={!node.teamSize}
                      onClick={() =>
                        setOpen((x) => (x === node.id ? null : node.id))
                      }
                      className={control + " p-2"}
                    >
                      <ChevronDown
                        size={18}
                        className={open === node.id ? "rotate-180" : ""}
                      />
                    </button>
                  </div>
                  <div className="mt-5 grid grid-cols-3 gap-3 text-xs text-[#929292]">
                    <span>
                      团队 GMV
                      <strong className="mt-2 block break-all font-mono text-sm text-[#F5F5F5]">
                        ¥{formatMoney(node.teamGmv)}
                      </strong>
                    </span>
                    <span>
                      平台贡献
                      <strong className="mt-2 block break-all font-mono text-sm text-[var(--positive)]">
                        ¥{formatMoney(node.teamPlatformContribution)}
                      </strong>
                    </span>
                    <span>
                      直属团队
                      <strong className="mt-2 block font-mono text-sm text-[#F5F5F5]">
                        {node.teamSize} 人
                      </strong>
                    </span>
                  </div>
                </div>
                {open === node.id && (
                  <Children
                    node={node}
                    period={period}
                    demo={demo}
                    refreshKey={refreshKey}
                  />
                )}
              </article>
            ))}
            {!nodes.length && (
              <p className={card + " p-8 text-sm text-[#929292]"}>
                没有符合条件的一级代理
              </p>
            )}
          </div>
          {!mobile && (
            <aside className={card + " sticky top-28 p-6"}>
              <UsersRound className="text-[var(--positive)]" />
              <h3 className="mt-4 font-bold">
                {selected?.displayName ?? "代理透视"}
              </h3>
              {selected ? (
                <>
                  <p className="mt-6 text-sm text-[#929292]">钱包可用余额</p>
                  <p className="mt-2 break-all font-mono text-3xl">
                    ¥{formatMoney(selected.balance)}
                  </p>
                  <p className="mt-6 text-sm text-[#929292]">历史净收益</p>
                  <p className="mt-2 font-mono">
                    ¥{formatMoney(selected.totalEarned)}
                  </p>
                  <p className="mt-6 text-sm text-[#929292]">
                    直属团队 {selected.teamSize} 人 · 自身 GMV ¥
                    {formatMoney(selected.ownGmv)}
                  </p>
                </>
              ) : (
                <p className="mt-4 text-sm text-[#929292]">
                  点击代理昵称查看钱包与团队规模。
                </p>
              )}
            </aside>
          )}
        </div>
      )}
      {mobile && selected && (
        <Sheet
          title={selected.displayName + " · 代理详情"}
          onClose={() => setSelected(null)}
        >
          <dl className="space-y-5 text-sm">
            <div>
              <dt className="text-[#929292]">钱包可用余额</dt>
              <dd className="mt-2 break-all font-mono text-2xl">
                ¥{formatMoney(selected.balance)}
              </dd>
            </div>
            <div>
              <dt className="text-[#929292]">历史净收益</dt>
              <dd className="mt-2 break-all font-mono">
                ¥{formatMoney(selected.totalEarned)}
              </dd>
            </div>
            <div>
              <dt className="text-[#929292]">直属成员</dt>
              <dd className="mt-2 font-mono">{selected.teamSize} 人</dd>
            </div>
            <div>
              <dt className="text-[#929292]">
                团队 GMV · {period === "month" ? "本月" : "全周期"}
              </dt>
              <dd className="mt-2 break-all font-mono">
                ¥{formatMoney(selected.teamGmv)}
              </dd>
            </div>
          </dl>
        </Sheet>
      )}
      {!demo && (data?.totalPages ?? 0) > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-[#929292]">
            共 {data?.total} 位一级代理 · 第 {page} 页
          </span>
          <div className="flex gap-2">
            <button
              className={control}
              disabled={loading || page === 1}
              onClick={() => setPage((x) => x - 1)}
            >
              上一页
            </button>
            <button
              className={control}
              disabled={loading || page >= (data?.totalPages ?? 1)}
              onClick={() => setPage((x) => x + 1)}
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
