'use client';

import { useEffect } from 'react';

/** Keeps a conversation scrolled to its newest message when it opens and when messages arrive. */
export function ScrollToEnd({ count }: { count: number }) {
  useEffect(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: count ? 'instant' : 'auto' });
  }, [count]);
  return null;
}
