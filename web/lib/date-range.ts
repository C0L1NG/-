export type RangeChoice = "all" | "month" | "previous" | "custom";
export type DateBounds = { from?: string; to?: string };

function day(value: Date): string {
  return value.toISOString().slice(0, 10);
}
function validDay(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    day(new Date(value)) === value
  );
}

// UI end dates are inclusive; API `to` is the exclusive UTC midnight.
export function dateBounds(
  choice: RangeChoice,
  now: Date,
  start = "",
  end = "",
): DateBounds {
  if (choice === "all") return {};
  if (choice === "custom") {
    if (!validDay(start) || !validDay(end) || start > end)
      throw new Error("请选择有效日期，结束日期不能早于开始日期");
    const next = new Date(end + "T00:00:00.000Z");
    next.setUTCDate(next.getUTCDate() + 1);
    return { from: start, to: day(next) };
  }
  const month = now.getUTCMonth() - (choice === "previous" ? 1 : 0);
  return {
    from: day(new Date(Date.UTC(now.getUTCFullYear(), month, 1))),
    to: day(new Date(Date.UTC(now.getUTCFullYear(), month + 1, 1))),
  };
}

export function dateIncludes(at: string, bounds: DateBounds): boolean {
  return (!bounds.from || at >= bounds.from) && (!bounds.to || at < bounds.to);
}
