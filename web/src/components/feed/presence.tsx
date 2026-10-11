'use client';

import { useEffect, useState } from 'react';

/**
 * How many people are looking at the same thing right now, over Realtime presence.
 * Loaded after the page settles; it simply shows nothing if presence is unavailable.
 */
export function Watching({ topic, className, suffix = 'watching now' }: { topic: string; className?: string; suffix?: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;
    const timer = setTimeout(async () => {
      const { createClient } = await import('@/lib/supabase/client');
      if (disposed) return;
      const supabase = createClient();
      const channel = supabase.channel(`watch:${topic}`, { config: { presence: { key: crypto.randomUUID() } } });
      channel
        .on('presence', { event: 'sync' }, () => setCount(Object.keys(channel.presenceState()).length))
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') await channel.track({ at: Date.now() });
        });
      cleanup = () => {
        supabase.removeChannel(channel);
      };
    }, 800);
    return () => {
      disposed = true;
      clearTimeout(timer);
      cleanup?.();
    };
  }, [topic]);
  if (count < 1) return null;
  return (
    <span className={className} aria-live="polite">
      {count} {suffix}
    </span>
  );
}
