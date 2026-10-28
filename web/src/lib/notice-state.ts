/** Optimistic notification updates live outside a row so navigation cannot cancel a queued decision. */
export type NoticeDecision = 'approve' | 'decline';
export interface NoticeUpdate {
  read: boolean;
  decision?: NoticeDecision;
}

export function createNoticeState({ schedule = setTimeout, cancel = clearTimeout } = {}) {
  const empty: ReadonlyMap<number, NoticeUpdate> = new Map();
  let snapshot = empty;
  const listeners = new Set<() => void>();
  const queued = new Map<number, ReturnType<typeof setTimeout>>();
  const publish = (id: number, value?: NoticeUpdate) => {
    const next = new Map(snapshot);
    if (value) next.set(id, value);
    else next.delete(id);
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => empty,
    async read(id: number, save: () => Promise<void>) {
      const before = snapshot.get(id);
      if (before?.read) return;
      const update = { read: true };
      publish(id, update);
      try {
        await save();
      } catch (error) {
        if (snapshot.get(id) === update) publish(id, before);
        throw error;
      }
    },
    decide(id: number, decision: NoticeDecision, save: () => Promise<void>, onError: (error: unknown) => void, delay = 5000) {
      if (snapshot.get(id)?.decision) return null;
      const before = snapshot.get(id);
      const update = { read: true, decision };
      publish(id, update);
      const timer = schedule(async () => {
        queued.delete(id);
        try {
          await save();
        } catch (error) {
          if (snapshot.get(id) === update) publish(id, before);
          onError(error);
        }
      }, delay);
      queued.set(id, timer);
      return () => {
        if (queued.get(id) !== timer) return false;
        cancel(timer);
        queued.delete(id);
        publish(id, before);
        return true;
      };
    },
  };
}

export const noticeState = createNoticeState();
