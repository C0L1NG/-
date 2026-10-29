"use client";
import { useEffect, useState } from "react";

export function useResource<T>(
  path: string | null,
  revision: number,
  get: (path: string, signal: AbortSignal) => Promise<T>,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    get(path, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        setUpdatedAt(new Date().toISOString());
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, revision, get]);
  return { data, error, loading, updatedAt };
}
