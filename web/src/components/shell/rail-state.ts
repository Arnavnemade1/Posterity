'use client';

import { useSyncExternalStore } from 'react';

export const RAIL_COOKIE = 'rail';
const EVENT = 'posterity:rail';
const WIDE = '(min-width: 1280px)';

function subscribe(onChange: () => void) {
  const query = window.matchMedia(WIDE);
  window.addEventListener(EVENT, onChange);
  query.addEventListener('change', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    query.removeEventListener('change', onChange);
  };
}

/** The rail is icons only when the window is narrow or the person collapsed it (the shell's `data-rail`). */
function collapsed() {
  return document.querySelector<HTMLElement>('[data-rail]')?.dataset.rail === 'collapsed' || !window.matchMedia(WIDE).matches;
}

export function useRailCollapsed() {
  return useSyncExternalStore(subscribe, collapsed, () => false);
}

/** Collapse or expand the rail. The shell restyles itself from `data-rail`; the cookie makes the server draw it the same next time. */
export function setRailCollapsed(value: boolean) {
  const shell = document.querySelector<HTMLElement>('[data-rail]');
  if (shell) shell.dataset.rail = value ? 'collapsed' : 'expanded';
  document.cookie = `${RAIL_COOKIE}=${value ? 'collapsed' : 'expanded'}; path=/; max-age=31536000; samesite=lax`;
  window.dispatchEvent(new Event(EVENT));
}
