'use client';
import { useEffect, useState } from 'react';

/** Per-viewer UI preference (filters, toggles). Falls back silently when storage is unavailable. */
export function usePersistentState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) setValue({ ...(typeof initial === 'object' ? initial : {}), ...JSON.parse(raw) } as T);
    } catch {
      /* ignore */
    }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  };
  return [value, set];
}
