"use client";
import { useState } from "react";
import {
  dateBounds,
  type DateBounds,
  type RangeChoice,
} from "@/lib/date-range";

export function DateFilter({
  onChange,
  demo = false,
}: {
  onChange: (bounds: DateBounds) => void;
  demo?: boolean;
}) {
  const [choice, setChoice] = useState<RangeChoice>("all");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState("");
  const input =
    "min-h-11 min-w-0 rounded-xl border border-[var(--agent-line,rgba(255,255,255,.08))] bg-[var(--agent-surface,#121212)] px-3 text-sm text-[var(--agent-text,#F5F5F5)] [color-scheme:var(--agent-color-scheme,dark)]";
  function choose(value: RangeChoice) {
    setChoice(value);
    setError("");
    if (value !== "custom")
      onChange(
        dateBounds(value, demo ? new Date("2026-10-03T12:00:00Z") : new Date()),
      );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="筛选日期">
        {(
          [
            ["all", "全部时间"],
            ["month", "本月"],
            ["previous", "上月"],
            ["custom", "自定义"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={choice === value}
            onClick={() => choose(value)}
            className={
              "min-h-11 rounded-full px-3.5 text-xs font-semibold " +
              (choice === value
                ? "bg-[var(--action-bg)] text-[var(--action-text)]"
                : "border border-[var(--agent-line,rgba(255,255,255,.08))] text-[var(--agent-muted,#929292)]")
            }
          >
            {label}
          </button>
        ))}
      </div>
      {choice === "custom" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            try {
              onChange(dateBounds("custom", new Date(), start, end));
              setError("");
            } catch (reason) {
              setError((reason as Error).message);
            }
          }}
          className="space-y-2"
        >
          <div className="grid grid-cols-2 gap-2">
            <label className="min-w-0 text-xs text-[var(--agent-muted,#929292)]">
              开始日期
              <input
                aria-label="开始日期"
                type="date"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className={input + " mt-1 w-full"}
              />
            </label>
            <label className="min-w-0 text-xs text-[var(--agent-muted,#929292)]">
              结束日期
              <input
                aria-label="结束日期"
                type="date"
                required
                min={start || undefined}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className={input + " mt-1 w-full"}
              />
            </label>
          </div>
          <button
            type="submit"
            className="min-h-11 rounded-full bg-[var(--action-bg)] px-4 text-xs font-bold text-[var(--action-text)]"
          >
            应用日期 · UTC
          </button>
          {error && (
            <p
              role="alert"
              className="text-sm text-[var(--agent-text,#F5F5F5)]"
            >
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
