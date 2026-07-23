import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Returns a `[copied, copy]` tuple. Calling `copy()` flips `copied` to `true`
 * for `durationMs` (default 2000ms) and then resets it. Cleans up the pending
 * timer on unmount and on subsequent calls, so unmounting the consumer does
 * not leak a stale setState.
 *
 * Replaces the previous inline pattern:
 *   const [copied, setCopied] = useState(false)
 *   ...
 *   setCopied(true)
 *   setTimeout(() => setCopied(false), 2000)
 * which 4 components duplicated, none with cleanup, so they risked a setState
 * on an unmounted component.
 */
export function useCopiedFeedback(durationMs = 2000): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    setCopied(true);
    timerRef.current = setTimeout(() => {
      setCopied(false);
      timerRef.current = null;
    }, durationMs);
  }, [durationMs]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    },
    [],
  );

  return [copied, copy];
}
