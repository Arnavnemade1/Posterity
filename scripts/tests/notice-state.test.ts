import { describe, expect, test } from 'bun:test';
import { createNoticeState } from '../../web/src/lib/notice-state';

function harness() {
  let clock = 0;
  let id = 0;
  const timers = new Map<number, { at: number; run: () => void | Promise<void> }>();
  const state = createNoticeState({
    schedule: ((run: () => void | Promise<void>, ms: number) => {
      timers.set(++id, { at: clock + ms, run });
      return id;
    }) as unknown as typeof setTimeout,
    cancel: ((id: number) => timers.delete(id)) as unknown as typeof clearTimeout,
  });
  return { state, async tick(ms: number) {
    clock += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); await timer.run(); }
  } };
}

describe('notification acknowledgements and inline decisions', () => {
  test('opening a notice clears unread state immediately and saves once', async () => {
    const { state } = harness();
    let finish!: () => void;
    let saves = 0;
    const saving = state.read(12, () => { saves++; return new Promise<void>((resolve) => { finish = resolve; }); });
    expect(state.getSnapshot().get(12)?.read).toBe(true);
    await state.read(12, async () => { saves++; });
    expect(saves).toBe(1);
    finish();
    await saving;
    expect(state.getSnapshot().get(12)?.read).toBe(true);
  });

  test('failed reads restore unread state and allow retry', async () => {
    const { state } = harness();
    await expect(state.read(12, async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    expect(state.getSnapshot().has(12)).toBe(false);
    await state.read(12, async () => {});
    expect(state.getSnapshot().get(12)?.read).toBe(true);
  });

  test('Undo restores the unread count and prevents the decision from being sent', async () => {
    const { state, tick } = harness();
    let saves = 0;
    const undo = state.decide(12, 'approve', async () => { saves++; }, () => {});
    expect(state.getSnapshot().get(12)).toEqual({ read: true, decision: 'approve' });
    expect(undo?.()).toBe(true);
    expect(state.getSnapshot().has(12)).toBe(false);
    await tick(5000);
    expect(saves).toBe(0);
  });

  test('navigation cannot discard a decision and duplicate clicks cannot enqueue it twice', async () => {
    const { state, tick } = harness();
    let saves = 0;
    const unsubscribe = state.subscribe(() => {});
    const save = async () => { saves++; };
    const undo = state.decide(12, 'approve', save, () => {});
    expect(state.decide(12, 'decline', save, () => {})).toBeNull();
    unsubscribe(); // the notification page unmounts
    await tick(5000);
    expect(saves).toBe(1);
    expect(undo?.()).toBe(false); // a hovered toast cannot undo an already sent decision
    expect(state.getSnapshot().get(12)?.read).toBe(true);
  });

  test('a rejected decision restores the notice and can be retried', async () => {
    const { state, tick } = harness();
    const errors: unknown[] = [];
    state.decide(12, 'decline', async () => { throw new Error('expired'); }, (error) => errors.push(error));
    await tick(5000);
    expect(state.getSnapshot().has(12)).toBe(false);
    expect(errors).toHaveLength(1);
    expect(state.decide(12, 'approve', async () => {}, () => {})).not.toBeNull();
  });
});
