import { describe, expect, test } from 'bun:test';
import { createRefreshScheduler } from '../../web/src/lib/refresh-scheduler';

function harness() {
  let time = 0;
  let visible = true;
  let id = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const scheduler = createRefreshScheduler({
    schedule: ((fn: () => void, ms: number) => { timers.set(++id, { at: time + ms, fn }); return id; }) as typeof setTimeout,
    cancel: ((n: number) => timers.delete(n)) as unknown as typeof clearTimeout,
    visible: () => visible,
  });
  return { scheduler, timers, hide: () => { visible = false; }, show: () => { visible = true; scheduler.wake(); },
    tick(ms: number) { time += ms; for (const [id, t] of [...timers]) if (t.at <= time) { timers.delete(id); t.fn(); } },
  };
}

describe('shared live refresh budget', () => {
  test('500 independent subscribers and 10,000 changes produce one refresh per interval', () => {
    const h = harness(); let refreshes = 0;
    const subscribers = Array.from({ length: 500 }, () => h.scheduler.subscribe(() => refreshes++));
    for (let i = 0; i < 10000; i++) subscribers[i % 500].request();
    expect(h.timers.size).toBe(1);
    h.tick(5000); expect(refreshes).toBe(1);
    subscribers[0].request(); h.tick(5000); expect(refreshes).toBe(2);
  });
  test('continuous traffic cannot starve refresh', () => {
    const h = harness(); let n = 0; const s = h.scheduler.subscribe(() => n++);
    for (let i = 0; i < 100; i++) { s.request(); h.tick(100); }
    expect(n).toBe(2);
  });
  test('hidden tabs defer work until visible', () => {
    const h = harness(); let n = 0; const s = h.scheduler.subscribe(() => n++);
    s.request(); h.hide(); h.tick(5000); expect(n).toBe(0);
    for (let i = 0; i < 500; i++) s.request();
    expect(h.timers.size).toBe(0);
    h.show(); h.tick(5000); expect(n).toBe(1);
  });
  test('unmounted routes never refresh and do not cancel surviving subscribers', () => {
    const h = harness(); let n = 0;
    const gone = h.scheduler.subscribe(() => { throw new Error('stale route'); });
    const stays = h.scheduler.subscribe(() => n++);
    gone.request(); stays.request(); gone.dispose(); h.tick(5000); expect(n).toBe(1);
    stays.request(); stays.dispose(); expect(h.timers.size).toBe(0);
  });
});
