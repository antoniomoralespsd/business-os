'use client';
import { useSyncExternalStore } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'bos.theme';
const listeners = new Set<() => void>();

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(pref: ThemePref = getThemePref()) {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function setThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* ignore */
  }
  applyTheme(pref);
  listeners.forEach((l) => l());
}

export function useThemePref(): ThemePref {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      const m = window.matchMedia('(prefers-color-scheme: dark)');
      const onSys = () => getThemePref() === 'system' && applyTheme('system');
      m.addEventListener('change', onSys);
      return () => {
        listeners.delete(cb);
        m.removeEventListener('change', onSys);
      };
    },
    getThemePref,
    () => 'system',
  );
}

/** Inline script for <head>: sets the theme before first paint (no flash). */
export const THEME_BOOT_SCRIPT = `(function(){try{var p=localStorage.getItem('${KEY}');var d=p==='dark'||(p!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch(e){}})()`;
