"use client";
import { useEffect, useState } from "react";

type Resource<T> = {
  key: string | null;
  data: T | null;
  error: unknown;
  loading: boolean;
  updatedAt: string | null;
};
export function useResource<T>(
  path: string | null,
  revision: number,
  get: (path: string, signal: AbortSignal) => Promise<T>,
) {
  const [state, setState] = useState<Resource<T>>({
    key: path,
    data: null,
    error: null,
    loading: Boolean(path),
    updatedAt: null,
  });
  useEffect(() => {
    const controller = new AbortController();
    setState((previous) => ({
      key: path,
      data: previous.key === path ? previous.data : null,
      updatedAt: previous.key === path ? previous.updatedAt : null,
      error: null,
      loading: Boolean(path),
    }));
    if (!path) return () => controller.abort();
    get(path, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted)
          setState({
            key: path,
            data: result,
            error: null,
            loading: false,
            updatedAt: new Date().toISOString(),
          });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState((previous) => ({ ...previous, error, loading: false }));
      });
    return () => controller.abort();
  }, [path, revision, get]);
  const current = state.key === path;
  const data = current ? state.data : null;
  const loading = current ? state.loading : Boolean(path);
  return {
    data,
    error: current ? state.error : null,
    loading,
    initialLoading: loading && !data,
    refreshing: loading && Boolean(data),
    updatedAt: current ? state.updatedAt : null,
  };
}
