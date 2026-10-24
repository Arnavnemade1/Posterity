'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { copyToClipboard } from '@/lib/clipboard';

/** The state behind every copy button: idle, then copied (or error) for a moment. One implementation, so they all behave alike. */
export function useCopy(resetMs = 2000) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const copy = useCallback(
    async (text: string) => {
      if (timer.current) clearTimeout(timer.current);
      const ok = await copyToClipboard(text);
      setState(ok ? 'copied' : 'error');
      timer.current = setTimeout(() => setState('idle'), resetMs);
      return ok;
    },
    [resetMs],
  );

  return { state, copy };
}
