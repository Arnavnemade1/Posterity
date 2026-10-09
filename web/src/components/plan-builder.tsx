'use client';

import { Plus, X } from 'lucide-react';
import { useActionState, useMemo, useState } from 'react';
import { adoptPlan } from '@/app/actions';
import { FormMessage, SubmitButton } from '@/components/client-ui';
import { TaskGraph } from '@/components/task-graph';
import { buttonClass, cx } from '@/components/ui';

interface Row {
  id: number;
  title: string;
  kind: string;
  capabilities: string;
  depends_on: string[];
  acceptance_criteria: string;
  complexity: string;
  description: string;
}

const KINDS = ['research', 'code', 'analysis', 'writing', 'design', 'data', 'experiment', 'review', 'synthesis', 'ops', 'other'];

let nextId = 1;
const blank = (title = '', kind = 'research'): Row => ({
  id: nextId++,
  title,
  kind,
  capabilities: '',
  depends_on: [],
  acceptance_criteria: '',
  complexity: 'medium',
  description: '',
});

function keyFor(title: string, taken: Set<string>): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'task';
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
  taken.add(key);
  return key;
}

/** Visual plan editor. Dependencies may only point at earlier rows, so the graph is always acyclic. */
export function PlanBuilder({ name = 'plan' }: { name?: string }) {
  const [rows, setRows] = useState<Row[]>(() => [blank('', 'research'), blank('', 'synthesis')]);

  const { plan, keys } = useMemo(() => {
    const taken = new Set<string>();
    const keyById = new Map<number, string>();
    rows.forEach((r) => keyById.set(r.id, keyFor(r.title, taken)));
    const tasks = rows
      .filter((r) => r.title.trim().length >= 3)
      .map((r) => ({
        key: keyById.get(r.id)!,
        title: r.title.trim(),
        kind: r.kind,
        description: r.description.trim(),
        capabilities: r.capabilities.split(',').map((c) => c.trim()).filter(Boolean),
        depends_on: r.depends_on.filter((k) => [...keyById.values()].includes(k)),
        acceptance_criteria: r.acceptance_criteria.trim(),
        complexity: r.complexity,
      }));
    return { plan: { tasks }, keys: keyById };
  }, [rows]);

  const update = (id: number, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-4">
      <input type="hidden" name={name} value={JSON.stringify(plan)} />
      <ol className="space-y-3">
        {rows.map((row, index) => {
          const earlier = rows.slice(0, index).filter((r) => r.title.trim().length >= 3);
          return (
            <li key={row.id} className="rounded-xl border border-line bg-ink p-3">
              <div className="flex items-start gap-2">
                <span className="mt-2.5 w-5 shrink-0 text-right font-mono text-[11px] text-faint">{index + 1}</span>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="grid gap-2 sm:grid-cols-[1fr_140px_120px]">
                    <input
                      value={row.title}
                      onChange={(e) => update(row.id, { title: e.target.value })}
                      className="field"
                      placeholder="Task title"
                      aria-label={`Task ${index + 1} title`}
                    />
                    <select value={row.kind} onChange={(e) => update(row.id, { kind: e.target.value })} className="field" aria-label="Kind">
                      {KINDS.map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>
                    <select
                      value={row.complexity}
                      onChange={(e) => update(row.id, { complexity: e.target.value })}
                      className="field"
                      aria-label="Complexity"
                    >
                      <option value="low">low</option>
                      <option value="medium">medium</option>
                      <option value="high">high</option>
                    </select>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      value={row.capabilities}
                      onChange={(e) => update(row.id, { capabilities: e.target.value })}
                      className="field"
                      placeholder="Capabilities, comma separated"
                    />
                    <input
                      value={row.acceptance_criteria}
                      onChange={(e) => update(row.id, { acceptance_criteria: e.target.value })}
                      className="field"
                      placeholder="Acceptance criteria"
                    />
                  </div>
                  <textarea
                    value={row.description}
                    onChange={(e) => update(row.id, { description: e.target.value })}
                    rows={2}
                    className="field"
                    placeholder="Instructions for the agent (optional)"
                  />
                  {earlier.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="label mr-1">Needs</span>
                      {earlier.map((dep) => {
                        const key = keys.get(dep.id)!;
                        const on = row.depends_on.includes(key);
                        return (
                          <button
                            key={dep.id}
                            type="button"
                            onClick={() =>
                              update(row.id, { depends_on: on ? row.depends_on.filter((k) => k !== key) : [...row.depends_on, key] })
                            }
                            className={cx(
                              'rounded-md border px-2 py-0.5 font-mono text-[11px]',
                              on ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line text-faint hover:text-text',
                            )}
                            aria-pressed={on}
                          >
                            {key}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
                  className="mt-1.5 rounded-md p-1 text-faint hover:bg-white/5 hover:text-text disabled:opacity-30"
                  aria-label={`Remove task ${index + 1}`}
                  disabled={rows.length === 1}
                >
                  <X className="size-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <button type="button" onClick={() => setRows((prev) => [...prev, blank()])} className={buttonClass('ghost', 'sm')}>
        <Plus className="size-4" /> Add task
      </button>
      {plan.tasks.length > 0 && (
        <div className="rounded-xl border border-line bg-ink p-3">
          <div className="label mb-2">Preview</div>
          <TaskGraph
            linkTasks={false}
            tasks={plan.tasks.map((t) => ({ key: t.key, title: t.title, status: 'open', kind: t.kind, depends_on: t.depends_on }))}
          />
        </div>
      )}
    </div>
  );
}

export function AdoptPlanForm({ missionId }: { missionId: string }) {
  const [state, action] = useActionState(adoptPlan, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="mission_id" value={missionId} />
      <PlanBuilder />
      <div className="flex items-center gap-3">
        <SubmitButton pendingLabel="Adopting…">Adopt this plan</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
