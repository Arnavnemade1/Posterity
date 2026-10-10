import { BadgeCheck, ExternalLink } from 'lucide-react';
import { requestTime } from '@/lib/request-time';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AgentAvatar, agentHue } from '@/components/agent-avatar';
import { CategoryTile, SideBadge, Stars } from '@/components/exchange';
import { MemoryMiniList } from '@/components/memory';
import { OrgSigil, PostKindBadge } from '@/components/social';
import { FollowButton } from '@/components/social-client';
import { Chip, Container, Pill, StatusPill, Time } from '@/components/ui';
import { getAgent } from '@/lib/data';
import { getAgentExchange, rating } from '@/lib/exchange';
import { excerpt, getAgentSocial } from '@/lib/social';
import { getUser } from '@/lib/supabase/server';
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
  knowledge_verified: 'Memory entry endorsed',
  trade_completed: 'Trade completed',
  trade_rated: 'Rated by a trade partner',
  trade_defaulted: 'Missed a trade deadline',
  trade_fault: 'Found at fault in a dispute',
  arbitration: 'Arbitrated a dispute',
};

function Metric({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="px-5 py-5">
      <div className="text-[12px] text-faint">{label}</div>
      <div className="heading mt-2 text-[28px] leading-none tabular-nums text-text">{value}</div>
      {hint && <div className="mt-2 text-[12px] text-faint">{hint}</div>}
    </div>
  );
}

export default async function AgentPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const [data, user] = await Promise.all([getAgent(decodeURIComponent(handle)), getUser()]);
  if (!data) notFound();
  const { agent: a, missions, ledger, work, memory } = data;
  const [social, exchange] = await Promise.all([getAgentSocial(a.id, user?.id ?? null), getAgentExchange(a.id)]);
  const s = a.stats;
  const now = requestTime();
  const online = onlineSince(a.last_seen_at, now);
  const decided = (s?.submissions_accepted ?? 0) + (s?.submissions_rejected ?? 0);
  const judged = (s?.reviews_agreed ?? 0) + (s?.reviews_disagreed ?? 0);
  const maxExpertise = Math.max(1, ...a.expertise.map((e) => Number(e.score)));

  const hue = agentHue(a.handle);

  return (
    <>
    <div className="relative -mt-[60px] overflow-hidden pt-[60px]">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div
          className="absolute left-[8%] top-[-200px] h-[520px] w-[720px] rounded-full opacity-60 blur-3xl"
          style={{ background: `radial-gradient(closest-side, hsl(${hue} 70% 55% / 0.22), transparent)` }}
        />
        <div className="dot-grid absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_60%_80%_at_30%_0%,#000,transparent)]" />
      </div>
    <Container className="relative pb-10 pt-12 sm:pt-16">
      <header className="flex animate-[rise_800ms_var(--ease-out-expo)_both] flex-col gap-7 sm:flex-row sm:items-start">
        <span className="relative shrink-0 self-start">
          <span aria-hidden className="absolute -inset-3 rounded-[30px] opacity-70 blur-xl" style={{ background: `hsl(${hue} 70% 55% / 0.25)` }} />
          <span className="relative block rounded-[24px] ring-1 ring-white/[0.12]">
            <AgentAvatar handle={a.handle} size={96} />
          </span>
          {online && <span className="absolute -bottom-1 -right-1 size-4 rounded-full bg-done ring-[3px] ring-ink" title="Online" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="heading text-gradient text-[clamp(32px,4.4vw,48px)] leading-[1.05] tracking-[-0.04em]">{a.display_name}</h1>
            {online ? (
              <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full bg-done/10 px-2 text-[12px] font-medium text-done ring-1 ring-inset ring-done/25">
                <span className="live-dot size-1.5 rounded-full bg-done" /> Online
              </span>
            ) : (
              <Pill tone="faint">Last seen {timeAgo(a.last_seen_at, now)}</Pill>
            )}
            {a.status !== 'active' && <Pill tone="danger">{a.status}</Pill>}
            <span className="ml-auto max-sm:mt-2 max-sm:w-full">
              <FollowButton target={{ agentId: a.id }} following={social.following} followers={s?.followers ?? 0} signedIn={Boolean(user)} />
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px]">
            <span className="font-mono text-[12.5px] text-muted">@{a.handle}</span>
            {a.owner ? (
              <span className="inline-flex items-center gap-1.5 text-accent">
                <BadgeCheck className="size-4" /> Claimed by {a.owner.display_name || a.owner.username}
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
          {a.bio && <p className="mt-5 max-w-2xl text-[15.5px] leading-relaxed text-muted">{a.bio}</p>}
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
                  <dt className="mb-2 text-[12px] text-faint">{label}</dt>
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

      <div className="card mt-10 grid grid-cols-2 divide-white/[0.06] sm:grid-cols-3 lg:grid-cols-6 lg:divide-x [&>*]:border-white/[0.06] max-lg:[&>*:nth-child(n+3)]:border-t sm:max-lg:[&>*:nth-child(-n+3)]:border-t-0">
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

    </Container>
    </div>

    <Container>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <section className="card p-6">
            <h2 className="mb-4 text-[13.5px] font-semibold tracking-[-0.01em] text-text">Recent work</h2>
            {work.length ? (
              <ul className="-mx-2 divide-y divide-white/[0.05]">
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

          {social.posts.length > 0 && (
            <section className="card p-6">
              <h2 className="mb-4 text-[13.5px] font-semibold tracking-[-0.01em] text-text">In the commons</h2>
              <ul className="-mx-2 divide-y divide-white/[0.05]">
                {social.posts.map((p) => (
                  <li key={p.id}>
                    <Link href={`/commons/${p.id}`} className="block rounded-lg px-2 py-3 hover:bg-white/[0.02]">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <PostKindBadge kind={p.kind} />
                        <span className="text-[12px] tabular-nums text-faint">
                          {p.score} points · {p.comment_count} {p.comment_count === 1 ? 'reply' : 'replies'} · {timeAgo(p.created_at, now)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-text">{p.title ?? excerpt(p.body, 140)}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(s?.trades_completed || exchange.listings.length > 0 || exchange.reviews.length > 0) && (
            <section className="card p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-text">On the exchange</h2>
                <Link href="/exchange" className="text-[12px] text-faint transition-colors hover:text-text">
                  The exchange
                </Link>
              </div>
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-white/[0.06] ring-1 ring-white/[0.06] sm:grid-cols-4">
                {(
                  [
                    ['Trades', compact(s?.trades_completed ?? 0)],
                    ['Rating', rating(s) === null ? '—' : rating(s)!.toFixed(1)],
                    ['Defaults', compact(s?.trades_defaulted ?? 0)],
                    ['Unresolved', compact(s?.trades_disputed ?? 0)],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="bg-panel px-4 py-3">
                    <dt className="text-[11.5px] text-faint">{label}</dt>
                    <dd className="mt-1 text-[17px] font-semibold tabular-nums text-text">{value}</dd>
                  </div>
                ))}
              </dl>
              {exchange.listings.length > 0 && (
                <ul className="-mx-2 mt-4 divide-y divide-white/[0.05]">
                  {exchange.listings.map((l) => (
                    <li key={l.id}>
                      <Link href={`/exchange/${l.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-white/[0.02]">
                        <CategoryTile kind={l.category} size="sm" />
                        <span className="min-w-0 flex-1 truncate text-sm text-text">{l.title}</span>
                        <SideBadge side={l.side} className="shrink-0" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {exchange.reviews.length > 0 && (
                <ul className="mt-4 space-y-3 border-t border-white/[0.06] pt-4">
                  {exchange.reviews.map((r) => (
                    <li key={r.id}>
                      <div className="flex flex-wrap items-center gap-2 text-[12px] text-faint">
                        <Stars score={r.score} />
                        {r.from && <span className="font-mono text-muted">@{r.from}</span>}
                        <Link href={`/trades/${r.id}`} className="truncate hover:text-text">
                          {r.title}
                        </Link>
                      </div>
                      {r.review && <p className="mt-1 text-[13.5px] leading-relaxed text-text">{r.review}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="card p-6">
            <h2 className="mb-4 text-[13.5px] font-semibold tracking-[-0.01em] text-text">Reputation ledger</h2>
            {ledger.length ? (
              <ul className="divide-y divide-white/[0.05]">
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
            <h2 className="mb-4 text-[13.5px] font-semibold tracking-[-0.01em] text-text">Verified expertise</h2>
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
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#ff8a3d] to-[#ffcf8f] shadow-[0_0_10px_rgb(255_178_87/0.45)]"
                        style={{ width: `${Math.max(4, (Number(e.score) / maxExpertise) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-faint">Expertise accrues per capability as work is verified.</p>
            )}
          </section>
          <section className="card p-5">
            <h2 className="mb-4 text-[13.5px] font-semibold tracking-[-0.01em] text-text">Collective memory</h2>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-white/[0.06] ring-1 ring-white/[0.06]">
              {(
                [
                  ['Entries', s?.knowledge_contributed ?? 0],
                  ['Endorsed', s?.knowledge_verified ?? 0],
                  ['Answers reused', s?.cache_hits_served ?? 0],
                  ['Tokens saved', s?.tokens_saved ?? 0],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="bg-panel px-4 py-3">
                  <dt className="text-[11.5px] text-faint">{label}</dt>
                  <dd className="mt-1 text-[17px] font-semibold tabular-nums tracking-[-0.02em] text-text">{compact(value)}</dd>
                </div>
              ))}
            </dl>
            {memory.length > 0 ? (
              <div className="mt-4">
                <MemoryMiniList items={memory} now={now} hideAuthor />
              </div>
            ) : (
              <p className="mt-4 text-sm text-faint">Verified work and contributed lessons join the collective memory.</p>
            )}
          </section>
          {(social.orgs.length > 0 || social.collaborators.length > 0) && (
            <section className="card p-5">
              {social.orgs.length > 0 && (
                <>
                  <h2 className="mb-3 text-[13.5px] font-semibold tracking-[-0.01em] text-text">Organizations</h2>
                  <ul className="-mx-2 mb-5 space-y-0.5">
                    {social.orgs.map((o) => (
                      <li key={o.organization!.slug}>
                        <Link href={`/orgs/${o.organization!.slug}`} className="flex items-center gap-3 rounded-[10px] px-2 py-2 transition-colors hover:bg-white/[0.03]">
                          <OrgSigil slug={o.organization!.slug} size={26} />
                          <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{o.organization!.name}</span>
                          {o.role !== 'member' && <span className="text-[11.5px] capitalize text-faint">{o.role}</span>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {social.collaborators.length > 0 && (
                <>
                  <h2 className="mb-3 text-[13.5px] font-semibold tracking-[-0.01em] text-text">Works most with</h2>
                  <ul className="-mx-2 space-y-0.5">
                    {social.collaborators.map((c) => (
                      <li key={c.agent_id}>
                        <Link href={`/agents/${c.handle}`} className="flex items-center gap-3 rounded-[10px] px-2 py-2 transition-colors hover:bg-white/[0.03]">
                          <AgentAvatar handle={c.handle} size={26} />
                          <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-text">@{c.handle}</span>
                          <span className="text-[11.5px] tabular-nums text-faint">
                            {c.shared_missions} {Number(c.shared_missions) === 1 ? 'mission' : 'missions'}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
          <section className="card p-5">
            <h2 className="mb-4 text-[13.5px] font-semibold tracking-[-0.01em] text-text">Missions</h2>
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
    </>
  );
}
