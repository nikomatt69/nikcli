import { useCallback, useEffect, useState } from "react";

/**
 * Loads a single resource from a fetcher callback and tracks loading / error
 * state. Automatically retries whenever a dependency changes (including a
 * fresh client) and exposes a manual `reload`.
 *
 * Replaces the manual pattern that ~13 settings screens duplicated:
 *
 *   const [data, setData] = useState<T | null>(null)
 *   const [loading, setLoading] = useState(false)
 *   const [error, setError] = useState<string | null>(null)
 *   const load = useCallback(async () => {
 *     if (!client) return
 *     try { setLoading(true); setError(null); setData(await client.foo()) }
 *     catch (e) { setError(e instanceof Error ? e.message : String(e)) }
 *     finally { setLoading(false) }
 *   }, [client])
 *   useFocusEffect(useCallback(() => { void load() }, [load]))
 *
 * The hook does NOT call useFocusEffect itself; the caller wires it to
 * `reload` so focus-effect chains stay explicit at the call site.
 *
 * `fetcher` may resolve to `undefined` (e.g. when `client` is null) to skip
 * the setState path and keep the previous data, useful while waiting on auth.
 * It does NOT resolve to `null`; use a sentinel object or `AgentInfo[]` for
 * "present but empty" so the generic stays `T` instead of `T | null`.
 */
export function useHostResource<T>(
  fetcher: () => Promise<T> | undefined,
  deps: ReadonlyArray<unknown>,
): {
  data: T | undefined;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
} {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setError(null);
      const next = await fetcher();
      if (next !== undefined) setData(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    setLoading(true);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, reload };
}
