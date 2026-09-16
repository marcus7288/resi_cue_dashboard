import { useEffect, useState } from "react";

/**
 * Ticking wall clock.
 *
 * Reads Date.now() on every tick rather than accumulating, so the value cannot
 * drift away from real time even if a tick is delayed by a busy main thread.
 */
export function useClock(intervalMs = 100): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
