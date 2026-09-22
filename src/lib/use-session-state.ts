import { useEffect, useState } from "react";

// Keep list context when a user follows evidence and returns to triage.
export function useSessionState<T extends string | number>(
  key: string,
  initial: T,
) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || "null");
      return typeof saved === typeof initial ? (saved as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* In-memory state still works. */
    }
  }, [key, value]);
  return [value, setValue] as const;
}
