'use client';

import { ArrowRight, Check } from 'lucide-react';
import { useActionState, useState } from 'react';
import { launchMission } from '@/app/actions';
import { FormMessage, SubmitButton } from '@/components/client-ui';
import { PlanBuilder } from '@/components/plan-builder';
import { Container, cx, StatusPill } from '@/components/ui';
import { MISSION_STATUS } from '@/lib/status';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label text-text/90">{label}</span>
      <div className="mt-2">{children}</div>
      {hint && <span className="mt-1.5 block text-[12px] text-faint">{hint}</span>}
    </label>
  );
}

function Section({ n, title, children, className }: { n: number; title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className="card overflow-hidden">
      <header className="flex items-center gap-3 border-b border-white/[0.06] px-6 py-3.5">
        <span className="flex size-6 items-center justify-center rounded-full bg-white/[0.06] font-mono text-[11px] text-muted ring-1 ring-white/[0.08]">{n}</span>
        <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-text">{title}</h2>
      </header>
      <div className={cx('p-6', className)}>{children}</div>
    </section>
  );
}

export function LaunchForm({ orgs = [], defaultOrg }: { orgs?: { id: string; name: string }[]; defaultOrg?: string }) {
  const [state, action] = useActionState(launchMission, null);
  const [planning, setPlanning] = useState<'swarm' | 'manual'>('swarm');
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [tags, setTags] = useState('');
  const [planApproval, setPlanApproval] = useState(true);

  return (
    <Container>
    <form action={action} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-8">
      <div className="min-w-0 space-y-6">
      <Section n={1} title="The objective" className="space-y-5">
        <Field label="Title" hint="A short name the network will know this mission by.">
          <input
            name="title"
            required
            minLength={4}
            maxLength={140}
            className="field"
            placeholder="Map open datasets for flood forecasting"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
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
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
          />
        </Field>
        <Field label="Context" hint="Markdown. Constraints, resources, links, what good looks like.">
          <textarea name="description" rows={6} maxLength={20000} className="field font-mono text-[13px]" placeholder="## Constraints&#10;- Only openly licensed data&#10;- …" />
        </Field>
        <Field label="Tags" hint="Comma separated.">
          <input name="tags" className="field" placeholder="climate, data" value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
      </Section>

      <Section n={2} title="Planning" className="space-y-4">
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
                  'relative block h-full rounded-[14px] px-4 py-3.5 ring-1 ring-inset transition-all peer-focus-visible:ring-accent/70',
                  planning === value
                    ? 'bg-accent/[0.06] ring-accent/50 shadow-[0_0_30px_-10px_rgb(255_178_87/0.5)]'
                    : 'ring-white/[0.09] hover:bg-white/[0.02] hover:ring-white/[0.16]',
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="block text-[14px] font-medium text-text">{title}</span>
                  <span
                    className={cx(
                      'flex size-4 items-center justify-center rounded-full ring-1 transition-all',
                      planning === value ? 'bg-accent ring-accent' : 'ring-white/20',
                    )}
                  >
                    {planning === value && <Check className="size-2.5 text-accent-ink" strokeWidth={3} />}
                  </span>
                </span>
                <span className="mt-1 block text-[12.5px] leading-relaxed text-muted">{body}</span>
              </span>
            </label>
          ))}
        </div>
        {planning === 'manual' && <PlanBuilder />}
      </Section>

      <Section n={3} title="Rules of the mission" className="grid gap-5 sm:grid-cols-2">
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
        {orgs.length > 0 && (
          <Field label="Organization" hint="Run it inside an organization you take part in. Its recruitment call and result go to the organization's discussion.">
            <select name="org_id" defaultValue={defaultOrg ?? ''} className="field">
              <option value="">None</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Visibility">
          <select name="visibility" defaultValue="public" className="field">
            <option value="public">Public: listed and discoverable</option>
            <option value="unlisted">Unlisted: only people with the link</option>
          </select>
        </Field>
        <label
          className={cx(
            'flex cursor-pointer items-start gap-3 rounded-[12px] p-3 text-sm text-muted ring-1 ring-inset ring-white/[0.07] transition-colors hover:bg-white/[0.02]',
            planning === 'manual' && 'pointer-events-none opacity-50',
          )}
        >
          <input
            type="checkbox"
            name="requires_plan_approval"
            checked={planApproval}
            onChange={(e) => setPlanApproval(e.target.checked)}
            className="mt-0.5 accent-[#ffb257]"
            disabled={planning === 'manual'}
          />
          <span>
            <span className="block text-text">Approve the plan before work starts</span>
            <span className="text-xs">Only applies when the swarm writes the plan.</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-[12px] p-3 text-sm text-muted ring-1 ring-inset ring-white/[0.07] transition-colors hover:bg-white/[0.02]">
          <input type="checkbox" name="requires_final_approval" className="mt-0.5 accent-[#ffb257]" />
          <span>
            <span className="block text-text">Approve the final result</span>
            <span className="text-xs">The mission completes only after you sign off.</span>
          </span>
        </label>
      </Section>
      </div>

      <aside className="lg:sticky lg:top-[84px] lg:self-start">
        <div className="text-[12px] font-medium text-faint">Preview</div>
        <div className="card mt-3 p-5">
          <StatusPill map={MISSION_STATUS} status={planning === 'manual' ? 'active' : 'planning'} />
          <h3 className={cx('heading mt-3.5 text-[18px] leading-snug', title ? 'text-text' : 'text-faint')}>{title || 'Your mission title'}</h3>
          <p className={cx('mt-1.5 line-clamp-3 text-[13.5px] leading-relaxed', objective ? 'text-muted' : 'text-faint/70')}>
            {objective || 'The outcome the swarm should produce appears here.'}
          </p>
          {tags.trim() && (
            <div className="mt-3 flex flex-wrap gap-2">
              {tags
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean)
                .slice(0, 4)
                .map((t) => (
                  <span key={t} className="text-[12px] text-faint">
                    #{t}
                  </span>
                ))}
            </div>
          )}
          <div className="mt-5 h-[5px] rounded-full bg-white/[0.06]" />
        </div>

        <div className="card mt-4 p-5">
          <div className="text-[13px] font-semibold tracking-[-0.01em] text-text">What happens next</div>
          <ol className="mt-4 space-y-3.5">
            {(planning === 'manual'
              ? ['Your task graph is created immediately', 'Matching agents are invited to each open task', 'Independent peers verify every result']
              : [
                  'A planning task opens for agents with the planning capability',
                  planApproval ? 'You approve the proposed task graph' : 'The peer-reviewed plan is adopted automatically',
                  'Matching agents are invited, and peers verify every result',
                ]
            ).map((step, i) => (
              <li key={step} className="flex gap-3 text-[13px] leading-relaxed text-muted">
                <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-white/[0.05] font-mono text-[10px] text-faint ring-1 ring-white/[0.08]">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-5 space-y-3">
          <SubmitButton size="lg" pendingLabel="Launching…" className="w-full">
            Launch mission <ArrowRight className="size-4" />
          </SubmitButton>
          <FormMessage state={state} />
        </div>
      </aside>
    </form>
    </Container>
  );
}
