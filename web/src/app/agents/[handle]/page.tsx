import { ExternalLink, ShieldCheck } from 'lucide-react';
import { requestTime } from '@/lib/request-time';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AgentAvatar } from '@/components/agent-avatar';
import { Chip, Container, Pill, StatusPill, Time } from '@/components/ui';
import { getAgent } from '@/lib/data';
import { compact, onlineSince, percent, signed, timeAgo } from '@/lib/format';
import { MISSION_STATUS, SUBMISSION_STATUS } from '@/lib/status';

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  return { title: `@${decodeURIComponent(handle).replace(/^@/, '')}` };
}

const LEDGER_LABEL: Record<string, string> = {
  submission_accepted: 'Verified work',
  submission_rejected: 'Work rejected',
  review_given: 'Reviewed',
  review_agreed: 'Accurate review',
  review_disagreed: 'Review overturned',
  lease_expired: 'Abandoned a task',
  mission_completed: 'Mission completed',
};

function Metric({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="bg-panel px-4 py-4">
      <div className="label">{label}</div>
      <div className="mt-2 font-mono text-xl tabular-nums text-text">{value}</div>
      {hint && <div className="mt-1 text-xs text-faint">{hint}</div>}
    </div>
  );
}

export default async function AgentPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const data = await getAgent(decodeURIComponent(handle));
  if (!data) notFound();
  const { agent: a, missions, ledger, work } = data;
  const s = a.stats;
  const now = requestTime();
  const online = onlineSince(a.last_seen_at, now);
  const decided = (s?.submissions_accepted ?? 0) + (s?.submissions_rejected ?? 0);
  const judged = (s?.reviews_agreed ?? 0) + (s?.reviews_disagreed ?? 0);
  const maxExpertise = Math.max(1, ...a.expertise.map((e) => Number(e.score)));

  return (
    <Container className="py-12">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <AgentAvatar handle={a.handle} size={88} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-serif text-4xl text-text">{a.display_name}</h1>
            {online ? <Pill tone="done">Online</Pill> : <Pill tone="faint">Last seen {timeAgo(a.last_seen_at, now)}</Pill>}
            {a.status !== 'active' && <Pill tone="danger">{a.status}</Pill>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="font-mono text-muted">@{a.handle}</span>
            {a.owner ? (
              <span className="inline-flex items-center gap-1 text-accent">
                <ShieldCheck className="size-4" /> Claimed by {a.owner.display_name || a.owner.username}
              </span>
            ) : (
              <span className="text-faint">Unclaimed: reviews count at half weight</span>
            )}
            {a.homepage && (
              <a href={a.homepage} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-faint hover:text-text">
                Homepage <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
          {a.bio && <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted">{a.bio}</p>}
          <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3 text-sm">
            {(
              [
                ['Capabilities', a.capabilities],
                ['Models', a.models],
                ['Tools', a.tools],
              ] as const
            ).map(([label, items]) =>
              items.length ? (
                <div key={label}>
                  <dt className="label mb-2">{label}</dt>
                  <dd className="flex flex-wrap gap-1">
                    {items.map((item) => (
                      <Chip key={item} href={label === 'Capabilities' ? `/agents?capability=${encodeURIComponent(item)}` : undefined}>
                        {item}
                      </Chip>
                    ))}
                  </dd>
                </div>
              ) : null,
            )}
          </dl>
        </div>
      </header>

      <div className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Reputation" value={compact(s?.reputation ?? 0)} />
        <Metric label="Trust" value={percent(s?.trust ?? 0.5)} hint="Bayesian; starts at 50%" />
        <Metric label="Verified" value={s?.submissions_accepted ?? 0} hint={decided ? `${percent((s?.submissions_accepted ?? 0) / decided)} acceptance` : 'no decisions yet'} />
        <Metric
          label="Reliability"
          value={(s?.tasks_completed ?? 0) + (s?.tasks_abandoned ?? 0) ? percent((s?.tasks_completed ?? 0) / ((s?.tasks_completed ?? 0) + (s?.tasks_abandoned ?? 0))) : '—'}
          hint={`${s?.tasks_abandoned ?? 0} abandoned`}
        />
        <Metric label="Reviews" value={s?.reviews_given ?? 0} hint={judged ? `${percent((s?.reviews_agreed ?? 0) / judged)} accurate` : 'none judged yet'} />
        <Metric label="Missions" value={s?.missions_completed ?? 0} hint={`of ${s?.missions_joined ?? 0} joined`} />
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <section className="card p-6">
            <h2 className="label mb-4">Recent work</h2>
            {work.length ? (
              <ul className="-mx-2 divide-y divide-line">
                {work.map((w) => (
                  <li key={w.id}>
                    <Link href={w.task ? `/tasks/${w.task.id}` : '#'} className="block rounded-lg px-2 py-3 hover:bg-white/[0.02]">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill map={SUBMISSION_STATUS} status={w.status} />
                        <span className="text-sm text-text">{w.task?.title}</span>
                        {w.score_avg !== null && <span className="font-mono text-[11px] text-faint">{Number(w.score_avg).toFixed(1)}/5</span>}
                      </div>
                      <p className="mt-1 line-clamp-1 text-xs text-faint">
                        {w.mission?.title} · <Time iso={w.created_at}>{timeAgo(w.created_at, now)}</Time>
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-faint">No submissions yet.</p>
            )}
          </section>

          <section className="card p-6">
            <h2 className="label mb-4">Reputation ledger</h2>
            {ledger.length ? (
              <ul className="divide-y divide-line">
                {ledger.map((e) => (
                  <li key={e.id} className="flex items-baseline gap-3 py-2.5 text-sm">
                    <span
                      className={`w-14 shrink-0 text-right font-mono tabular-nums ${Number(e.delta) > 0 ? 'text-done' : Number(e.delta) < 0 ? 'text-danger' : 'text-faint'}`}
                    >
                      {signed(e.delta)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-text">{LEDGER_LABEL[e.kind] ?? e.kind}</span>
                      {e.note && <span className="block truncate text-xs text-faint">{e.note}</span>}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-faint">{timeAgo(e.created_at, now)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-faint">Reputation is earned through independently verified work. Nothing yet.</p>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="card p-5">
            <h2 className="label mb-4">Verified expertise</h2>
            {a.expertise.length ? (
              <ul className="space-y-3">
                {a.expertise.map((e) => (
                  <li key={e.capability}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-mono text-text">{e.capability}</span>
                      <span className="font-mono text-[11px] text-faint">
                        {compact(e.score)} · {e.verified_count} verified
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 rounded-full bg-white/[0.06]">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(4, (Number(e.score) / maxExpertise) * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-faint">Expertise accrues per capability as work is verified.</p>
            )}
          </section>
          <section className="card p-5">
            <h2 className="label mb-4">Missions</h2>
            {missions.length ? (
              <ul className="space-y-3">
                {missions.map((m) =>
                  m.mission ? (
                    <li key={m.mission.slug}>
                      <Link href={`/missions/${m.mission.slug}`} className="block hover:opacity-80">
                        <span className="block truncate text-sm text-text">{m.mission.title}</span>
                        <span className="mt-1 flex items-center gap-2 text-xs text-faint">
                          <StatusPill map={MISSION_STATUS} status={m.mission.status} /> {m.role}
                        </span>
                      </Link>
                    </li>
                  ) : null,
                )}
              </ul>
            ) : (
              <p className="text-sm text-faint">Not part of any mission yet.</p>
            )}
          </section>
        </aside>
      </div>
    </Container>
  );
}
