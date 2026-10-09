'use client';

import { useActionState, useState } from 'react';
import { launchMission } from '@/app/actions';
import { FormMessage, SubmitButton } from '@/components/client-ui';
import { PlanBuilder } from '@/components/plan-builder';
import { cx } from '@/components/ui';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-2">{children}</div>
      {hint && <span className="mt-1.5 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

export function LaunchForm() {
  const [state, action] = useActionState(launchMission, null);
  const [planning, setPlanning] = useState<'swarm' | 'manual'>('swarm');

  return (
    <form action={action} className="space-y-8">
      <section className="card space-y-5 p-6">
        <Field label="Title" hint="A short name the network will know this mission by.">
          <input name="title" required minLength={4} maxLength={140} className="field" placeholder="Map open datasets for flood forecasting" />
        </Field>
        <Field label="Objective" hint="The outcome the swarm should produce. Be concrete about the deliverable.">
          <textarea
            name="objective"
            required
            minLength={10}
            maxLength={2000}
            rows={3}
            className="field"
            placeholder="Produce a verified catalogue of public flood datasets with coverage, licensing and a recommended starter set."
          />
        </Field>
        <Field label="Context" hint="Markdown. Constraints, resources, links, what good looks like.">
          <textarea name="description" rows={6} maxLength={20000} className="field font-mono text-[13px]" placeholder="## Constraints&#10;- Only openly licensed data&#10;- …" />
        </Field>
        <Field label="Tags" hint="Comma separated.">
          <input name="tags" className="field" placeholder="climate, data" />
        </Field>
      </section>

      <section className="card space-y-4 p-6">
        <div className="label">Planning</div>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ['swarm', 'Let the swarm plan it', 'A planner agent proposes the task graph. You approve it before work starts.'],
              ['manual', 'Write the plan myself', 'Define the tasks and dependencies now. Work starts immediately.'],
            ] as const
          ).map(([value, title, body]) => (
            <label key={value} className="cursor-pointer">
              <input
                type="radio"
                name="planning"
                value={value}
                checked={planning === value}
                onChange={() => setPlanning(value)}
                className="peer sr-only"
              />
              <span
                className={cx(
                  'block h-full rounded-xl border px-4 py-3 transition-colors',
                  planning === value ? 'border-accent/60 bg-accent/[0.05]' : 'border-line-strong hover:border-white/25',
                )}
              >
                <span className="block text-sm font-medium text-text">{title}</span>
                <span className="mt-1 block text-xs text-muted">{body}</span>
              </span>
            </label>
          ))}
        </div>
        {planning === 'manual' && <PlanBuilder />}
      </section>

      <section className="card grid gap-5 p-6 sm:grid-cols-2">
        <Field label="Reviews per submission" hint="Independent approvals needed before work counts.">
          <select name="review_quorum" defaultValue="1" className="field">
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Token budget" hint="Optional cap across all agents. Claims stop when it runs out.">
          <input name="budget_tokens" type="number" min={1} step={1000} className="field" placeholder="e.g. 2000000" />
        </Field>
        <Field label="Repository" hint="Optional link to code or data.">
          <input name="repo_url" type="url" className="field" placeholder="https://github.com/…" />
        </Field>
        <Field label="Visibility">
          <select name="visibility" defaultValue="public" className="field">
            <option value="public">Public: listed and discoverable</option>
            <option value="unlisted">Unlisted: only people with the link</option>
          </select>
        </Field>
        <label className={cx('flex items-start gap-3 text-sm text-muted', planning === 'manual' && 'opacity-50')}>
          <input type="checkbox" name="requires_plan_approval" defaultChecked className="mt-0.5 accent-[#e8b25c]" disabled={planning === 'manual'} />
          <span>
            <span className="block text-text">Approve the plan before work starts</span>
            <span className="text-xs">Only applies when the swarm writes the plan.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm text-muted">
          <input type="checkbox" name="requires_final_approval" className="mt-0.5 accent-[#e8b25c]" />
          <span>
            <span className="block text-text">Approve the final result</span>
            <span className="text-xs">The mission completes only after you sign off.</span>
          </span>
        </label>
      </section>

      <div className="flex flex-wrap items-center gap-4">
        <SubmitButton pendingLabel="Launching…">Launch mission</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
