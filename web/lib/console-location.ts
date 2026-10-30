import type { DateBounds } from "./date-range";
export type Workspace = "overview" | "network" | "audit" | "treasury";
export type ConsoleLocation = {
  view: Workspace;
  period: "all" | "month";
  page: number;
  q: string;
  bounds: DateBounds;
};

export function readConsoleLocation(params: URLSearchParams): ConsoleLocation {
  const value = params.get("view");
  const view: Workspace =
    value === "network" || value === "audit" || value === "treasury"
      ? value
      : "overview";
  const rawPage = Number(params.get("page") || 1);
  const bounds: DateBounds = {};
  for (const key of ["from", "to"] as const) {
    const date = params.get(key);
    if (
      date &&
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      !Number.isNaN(Date.parse(date)) &&
      new Date(date).toISOString().slice(0, 10) === date
    )
      bounds[key] = date;
  }
  if (bounds.from && bounds.to && bounds.from >= bounds.to) {
    delete bounds.from;
    delete bounds.to;
  }
  return {
    view,
    period: params.get("period") === "month" ? "month" : "all",
    page:
      Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 10000
        ? rawPage
        : 1,
    q: (params.get("q") || "").slice(0, 80),
    bounds,
  };
}

export function writeConsoleLocation(url: URL, state: ConsoleLocation): URL {
  for (const key of ["view", "period", "page", "q", "from", "to"])
    url.searchParams.delete(key);
  url.searchParams.set("view", state.view);
  if (state.period !== "all") url.searchParams.set("period", state.period);
  if (state.page > 1) url.searchParams.set("page", String(state.page));
  if (state.q) url.searchParams.set("q", state.q);
  if (state.bounds.from) url.searchParams.set("from", state.bounds.from);
  if (state.bounds.to) url.searchParams.set("to", state.bounds.to);
  return url;
}
