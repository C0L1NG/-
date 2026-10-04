"use client";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export function useLiveRefresh(enabled: boolean) {
  const [revision, setRevision] = useState(0);
  const last = useRef(0);
  const refresh = useCallback(() => {
    last.current = Date.now();
    setRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const resume = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - last.current > 1000
      )
        refresh();
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 60_000);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [enabled, refresh]);
  return { revision, refresh };
}

export function RefreshStatus({
  at,
  busy,
  onRefresh,
  demo = false,
}: {
  at: string | null;
  busy: boolean;
  onRefresh: () => void;
  demo?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-[var(--agent-muted,#929292)]">
      <span>
        {demo
          ? "演示快照 · 2026-10-03 UTC"
          : at
            ? `更新于 ${at.slice(11, 19)} UTC · 每分钟刷新`
            : "正在读取最新数据"}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={onRefresh}
        aria-label="刷新当前页面"
        className="flex min-h-11 items-center gap-1.5 rounded-full px-2 text-[var(--agent-accent-text,#F5F5F5)] disabled:opacity-40"
      >
        <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
        刷新
      </button>
    </div>
  );
}
