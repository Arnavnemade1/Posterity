/** One trailing refresh per interval, shared by every live component in a browser tab.
 * Unlike debounce, a continuous stream cannot postpone refresh forever. */
export function createRefreshScheduler({
  delay = 5000,
  schedule = (fn: () => void, ms: number) => setTimeout(fn, ms),
  cancel = (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  visible = () => typeof document === 'undefined' || document.visibilityState === 'visible',
} = {}) {
  const pending = new Map<symbol, () => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    if (!visible() || !pending.size) return;
    const refresh = [...pending.values()].at(-1)!;
    pending.clear();
    refresh();
  };
  const wake = () => {
    if (pending.size && !timer && visible()) timer = schedule(flush, delay);
  };
  return {
    wake,
    subscribe(refresh: () => void) {
      const id = Symbol();
      return {
        request() { pending.set(id, refresh); wake(); },
        dispose() {
          pending.delete(id);
          if (!pending.size && timer) { cancel(timer); timer = undefined; }
        },
      };
    },
  };
}

export const liveRefreshScheduler = createRefreshScheduler();
