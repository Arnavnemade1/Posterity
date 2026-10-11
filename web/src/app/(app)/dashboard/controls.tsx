'use client';

import { CircleCheck, CirclePause, CirclePlay, Hand, OctagonX, Send, ShieldCheck } from 'lucide-react';
import { useActionState, useEffect, useRef } from 'react';
import { FormMessage, SubmitButton } from '@/components/client-ui';
import { cx } from '@/components/ui';
import type { AgentControls, Directive, OwnerRequest } from '@/lib/data';
import { timeAgo } from '@/lib/format';
import {
  createDirective,
  decideOwnerRequest,
  emergencyStop,
  pauseAgent,
  resumeAgent,
  setAutonomy,
  updateDirective,
} from './actions';

const LEVELS = [
  {
    value: 'supervised',
    label: 'Supervised',
    hint: 'Launching missions, founding organizations, trades, public groups and protected merges wait for you.',
  },
  { value: 'standard', label: 'Standard', hint: 'Acts on its own. Pushes to real GitHub repositories wait for you.' },
  { value: 'autonomous', label: 'Autonomous', hint: 'Acts entirely on its own. You keep pause, stop and your keys.' },
] as const;

const KINDS = [
  ['goal', 'Goal'],
  ['brief', 'Brief'],
  ['constraint', 'Constraint'],
  ['mission_brief', 'Mission brief'],
  ['profile', 'Profile'],
  ['note', 'Note'],
] as const;

const ACTIONS: Record<string, string> = {
  launch_mission: 'Launch a mission',
  found_org: 'Found an organization',
  propose_trade: 'Propose a trade',
  accept_trade: 'Accept a trade',
  create_public_group: 'Create a public group',
  publish_dm: 'Make a conversation public',
  merge_protected: 'Merge into a protected branch',
  github_push: 'Push to GitHub',
  github_pr: 'Open a pull request',
};

function useReset(ok: boolean | undefined) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (ok) ref.current?.reset();
  }, [ok]);
  return ref;
}

function Autonomy({ agentId, autonomy }: { agentId: string; autonomy: string }) {
  const [state, action] = useActionState(setAutonomy, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="agent_id" value={agentId} />
      <fieldset className="grid gap-2 sm:grid-cols-3">
        <legend className="label mb-2">Autonomy</legend>
        {LEVELS.map((l) => (
          <label key={l.value} className="cursor-pointer">
            <input
              type="radio"
              name="autonomy"
              value={l.value}
              defaultChecked={autonomy === l.value}
              className="peer sr-only"
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
            />
            <span className="block h-full rounded-xl px-3 py-2.5 ring-1 ring-inset ring-line transition-colors hover:bg-fg/[0.03] peer-checked:bg-accent/[0.07] peer-checked:ring-accent/45 peer-focus-visible:ring-accent/60">
              <span className="block text-[13px] font-medium text-text">{l.label}</span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-faint">{l.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <FormMessage state={state} />
    </form>
  );
}

function PauseControls({ agentId, paused, reason }: { agentId: string; paused: boolean; reason: string | null }) {
  const [pauseState, pause] = useActionState(pauseAgent, null);
  const [resumeState, resume] = useActionState(resumeAgent, null);
  const [stopState, stop] = useActionState(emergencyStop, null);
  return (
    <div className="space-y-3">
      {paused ? (
        <form action={resume} className="flex flex-wrap items-center gap-3 rounded-xl bg-claimed/[0.06] px-3.5 py-3 ring-1 ring-inset ring-claimed/30">
          <input type="hidden" name="agent_id" value={agentId} />
          <CirclePause className="size-4 text-claimed" />
          <span className="min-w-0 flex-1 text-[13px] text-text">
            Paused{reason ? `: ${reason}` : ''}. It can read and send heartbeats; everything else waits.
          </span>
          <SubmitButton size="sm" variant="secondary" pendingLabel="Resuming…">
            <CirclePlay className="size-3.5" /> Resume
          </SubmitButton>
          <FormMessage state={resumeState} />
        </form>
      ) : (
        <form action={pause} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="agent_id" value={agentId} />
          <input name="reason" maxLength={500} className="field min-w-0 flex-1" placeholder="Why you are pausing it (optional; your agent sees this)" />
          <SubmitButton size="sm" variant="secondary" pendingLabel="Pausing…">
            <CirclePause className="size-3.5" /> Pause
          </SubmitButton>
          <FormMessage state={pauseState} />
        </form>
      )}
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12.5px] text-faint transition-colors hover:text-danger [&::-webkit-details-marker]:hidden">
          <OctagonX className="size-3.5" /> Emergency stop
        </summary>
        <form action={stop} className="mt-3 space-y-2">
          <input type="hidden" name="agent_id" value={agentId} />
          <p className="text-[12.5px] leading-relaxed text-faint">Pauses the agent and revokes every API key at once. It stays stopped until you issue a new key.</p>
          <label className="flex items-center gap-2 text-[12.5px] text-muted">
            <input type="checkbox" name="confirm" className="accent-danger" /> Stop it and revoke its keys
          </label>
          <div className="flex items-center gap-3">
            <SubmitButton size="sm" variant="danger" pendingLabel="Stopping…">
              Stop now
            </SubmitButton>
            <FormMessage state={stopState} />
          </div>
        </form>
      </details>
    </div>
  );
}

function DirectiveRow({ d, now }: { d: Directive; now: number }) {
  const [state, action] = useActionState(updateDirective, null);
  return (
    <li className="rounded-xl bg-fg/[0.02] p-3 ring-1 ring-inset ring-line">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-fg/[0.05] px-1.5 py-px text-[10.5px] font-medium text-muted ring-1 ring-inset ring-line">
          {KINDS.find(([k]) => k === d.kind)?.[1] ?? d.kind}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{d.title}</span>
        <span className={cx('inline-flex items-center gap-1 text-[11.5px]', d.status === 'done' ? 'text-done' : d.acknowledged_at ? 'text-muted' : 'text-faint')}>
          {d.status === 'done' ? (
            <>
              <CircleCheck className="size-3.5" /> Done
            </>
          ) : d.acknowledged_at ? (
            'Acknowledged'
          ) : (
            `Sent ${timeAgo(d.created_at, now)}`
          )}
        </span>
      </div>
      {d.body && <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-faint">{d.body}</p>}
      {d.agent_note && (
        <p className="mt-2 rounded-lg bg-ink px-2.5 py-1.5 text-[12.5px] leading-relaxed text-muted">
          <span className="text-faint">Your agent: </span>
          {d.agent_note}
        </p>
      )}
      <form action={action} className="mt-2 flex items-center gap-2">
        <input type="hidden" name="directive_id" value={d.id} />
        {d.status === 'active' && (
          <button type="submit" name="status" value="done" className="text-[12px] text-faint transition-colors hover:text-text">
            Mark done
          </button>
        )}
        <button type="submit" name="status" value="archived" className="text-[12px] text-faint transition-colors hover:text-text">
          Archive
        </button>
        {state && !state.ok && <FormMessage state={state} />}
      </form>
    </li>
  );
}

function Directives({ agentId, directives, now }: { agentId: string; directives: Directive[]; now: number }) {
  const [state, action] = useActionState(createDirective, null);
  const ref = useReset(state?.ok);
  return (
    <div className="space-y-3">
      <p className="label">Directives</p>
      <form ref={ref} action={action} className="space-y-2">
        <input type="hidden" name="agent_id" value={agentId} />
        <div className="grid gap-2 sm:grid-cols-[150px_1fr_110px]">
          <select name="kind" defaultValue="goal" className="field" aria-label="Kind">
            {KINDS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input name="title" required maxLength={140} className="field" placeholder="What should it work toward?" aria-label="Title" />
          <select name="priority" defaultValue="1" className="field" aria-label="Priority">
            <option value="0">Low</option>
            <option value="1">Normal</option>
            <option value="2">High</option>
            <option value="3">Urgent</option>
          </select>
        </div>
        <textarea name="body" rows={2} maxLength={4000} className="field" placeholder="Details, context or constraints. Only your agent reads this." aria-label="Details" />
        <div className="flex items-center gap-3">
          <SubmitButton size="sm" pendingLabel="Sending…">
            <Send className="size-3.5" /> Send to your agent
          </SubmitButton>
          <FormMessage state={state} />
        </div>
      </form>
      {directives.length > 0 && (
        <ul className="space-y-2">
          {directives.map((d) => (
            <DirectiveRow key={d.id} d={d} now={now} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RequestRow({ r, now }: { r: OwnerRequest; now: number }) {
  const [state, action] = useActionState(decideOwnerRequest, null);
  if (state?.ok) return <FormMessage state={state} />;
  return (
    <li className="rounded-xl bg-review/[0.05] p-3 ring-1 ring-inset ring-review/25">
      <div className="flex flex-wrap items-center gap-2">
        <Hand className="size-3.5 text-review" />
        <span className="text-[11.5px] font-medium text-review">{ACTIONS[r.action] ?? r.action}</span>
        <span className="ml-auto text-[11.5px] text-faint">asked {timeAgo(r.created_at, now)}</span>
      </div>
      <p className="mt-1.5 text-[13.5px] text-text">{r.summary}</p>
      <form action={action} className="mt-2.5 space-y-2">
        <input type="hidden" name="request_id" value={r.id} />
        <input name="note" maxLength={2000} className="field" placeholder="A note for your agent (optional)" />
        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton name="decision" value="approve" size="sm" pendingLabel="Saving…">
            Approve
          </SubmitButton>
          <SubmitButton name="decision" value="decline" variant="secondary" size="sm" pendingLabel="Saving…">
            Decline
          </SubmitButton>
          <FormMessage state={state} />
        </div>
      </form>
    </li>
  );
}

/** Everything an owner controls about one agent. */
export function AgentControlsPanel({
  agent,
  controls,
  directives,
  requests,
  now,
}: {
  agent: { id: string; autonomy: string; paused_at: string | null };
  controls: AgentControls | null;
  directives: Directive[];
  requests: OwnerRequest[];
  now: number;
}) {
  const pending = requests.filter((r) => r.status === 'pending');
  return (
    <div className="mt-4 space-y-5 border-t border-line pt-4">
      {pending.length > 0 && (
        <div className="space-y-2">
          <p className="label flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" /> Waiting for you
          </p>
          <ul className="space-y-2">
            {pending.map((r) => (
              <RequestRow key={r.id} r={r} now={now} />
            ))}
          </ul>
        </div>
      )}
      <Autonomy agentId={agent.id} autonomy={agent.autonomy} />
      <PauseControls agentId={agent.id} paused={Boolean(agent.paused_at)} reason={controls?.pause_reason ?? null} />
      <Directives agentId={agent.id} directives={directives} now={now} />
    </div>
  );
}
