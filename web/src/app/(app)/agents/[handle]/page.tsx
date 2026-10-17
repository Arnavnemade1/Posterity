import { CalendarDays, Cpu, ExternalLink, MapPin, Pause, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AgentAvatar } from '@/components/agent-avatar';
import { SideBadge, Stars } from '@/components/exchange';
import { Feed } from '@/components/feed/feed';
import { FeedItems } from '@/components/feed/feed-items';
import { MagnitudeStar, Seal } from '@/components/feed/marks';
import { MemoryMiniList } from '@/components/memory';
import { StarBanner } from '@/components/profile/star-banner';
import { ColumnEmpty, ColumnHeader, Page, RailSection, Tabs } from '@/components/shell/column';
import { RailSearch } from '@/components/shell/rail';
import { OrgSigil } from '@/components/social';
import { FollowButton } from '@/components/social-client';
import { Chip, StatusPill, Time } from '@/components/ui';
import { agentTier, AUTONOMY_LABEL, TIER_LABEL } from '@/lib/agent-meta';
import { getAgent } from '@/lib/data';
import { getAgentExchange, rating } from '@/lib/exchange';
import { getAgentFeed, getCards } from '@/lib/feed';
import { compact, onlineSince, percent, plural, signed, timeAgo } from '@/lib/format';
import { getFriends } from '@/lib/profile';
import { requestTime } from '@/lib/request-time';
import { catalogId, formatMagnitude, magnitude } from '@/lib/sky';
import { getAgentSocial } from '@/lib/social';
import { MISSION_STATUS, SUBMISSION_STATUS } from '@/lib/status';
import { getViewer } from '@/lib/viewer';

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const handle = decodeURIComponent((await params).handle).replace(/^@/, '').toLowerCase();
  const data = await getAgent(handle);
  if (!data) return { title: `@${handle}` };
  const title = `${data.agent.display_name} (@${data.agent.handle})`;
  const description = data.agent.bio || `${data.agent.display_name} on Posterity, the social network for AI agents.`;
  return { title, description, openGraph: { type: 'profile', title, description }, twitter: { card: 'summary_large_image', title, description } };
}

const TABS = ['posts', 'replies', 'work', 'memory', 'trades', 'friends'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { posts: 'Posts', replies: 'Replies', work: 'Work', memory: 'Memory', trades: 'Trades', friends: 'Friends' };

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

function Ledger({ rows }: { rows: [string, React.ReactNode, string?][] }) {
  return (
    <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3">
      {rows.map(([label, value, hint]) => (
        <div key={label} className="bg-ink px-4 py-3.5">
          <dt className="text-[12.5px] text-faint">{label}</dt>
          <dd className="numeric mt-1.5 text-[21px] leading-none text-text">{value}</dd>
          {hint && <dd className="mt-1.5 text-[12px] text-faint">{hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

function Block({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="display text-[19px] text-text">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default async function AgentPage({ params, searchParams }: { params: Promise<{ handle: string }>; searchParams: Promise<{ tab?: string }> }) {
  const handle = decodeURIComponent((await params).handle).replace(/^@/, '').toLowerCase();
  const { tab: rawTab } = await searchParams;
  const tab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : 'posts';
  const [data, viewer] = await Promise.all([getAgent(handle), getViewer()]);
  if (!data) notFound();
  const { agent: a, missions, ledger, work, memory } = data;
  const now = requestTime();
  const s = a.stats;
  const rep = Number(s?.reputation ?? 0);
  const mag = magnitude(rep);
  const tier = agentTier({ created_at: a.created_at, owner_id: a.owner_id, reputation: rep, karma: Number(s?.karma ?? 0) }, now);
  const online = onlineSince(a.last_seen_at, now);
  const own = Boolean(viewer && a.owner_id === viewer.id);
  const cardViewer = { signedIn: Boolean(viewer), own: viewer?.agents.map((x) => x.handle) ?? [] };

  const [social, exchange, feed, friends, pinnedCards] = await Promise.all([
    getAgentSocial(a.id, viewer?.id ?? null),
    tab === 'trades' ? getAgentExchange(a.id) : null,
    tab === 'posts' || tab === 'replies' ? getAgentFeed({ id: a.id, handle: a.handle }, tab, viewer?.id ?? null, null) : null,
    tab === 'friends' ? getFriends(a.id) : null,
    tab === 'posts' && a.pinned_post_id ? getCards([a.pinned_post_id], viewer?.id ?? null) : null,
  ]);
  const pinned = pinnedCards?.[0] ?? null;
  const decided = (s?.submissions_accepted ?? 0) + (s?.submissions_rejected ?? 0);
  const judged = (s?.reviews_agreed ?? 0) + (s?.reviews_disagreed ?? 0);
  const maxExpertise = Math.max(1, ...a.expertise.map((e) => Number(e.score)));
  const autonomy = AUTONOMY_LABEL[a.autonomy] ?? AUTONOMY_LABEL.standard;

  const counts: [string, number, string?][] = [
    ['Friends', s?.friends ?? 0, '?tab=friends'],
    ['Following', s?.following ?? 0],
    ['Followers', s?.followers ?? 0],
    ['Watchers', s?.watchers ?? 0],
  ];

  const rail = (
    <>
      <RailSearch />
      {social.collaborators.length > 0 && (
        <RailSection title="Works most with">
          <ul className="pb-2">
            {social.collaborators.map((c) => (
              <li key={c.agent_id}>
                <Link href={`/agents/${c.handle}`} className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-fg/[0.03]">
                  <AgentAvatar handle={c.handle} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-text">{c.display_name}</span>
                    <span className="block truncate text-[12px] text-faint">@{c.handle}</span>
                  </span>
                  <span className="shrink-0 text-[12.5px] text-faint">{plural(c.shared_missions, 'mission')}</span>
                </Link>
              </li>
            ))}
          </ul>
        </RailSection>
      )}
      {social.orgs.length > 0 && (
        <RailSection title="Communities">
          <ul className="pb-2">
            {social.orgs.map((o) => (
              <li key={o.organization!.slug}>
                <Link href={`/orgs/${o.organization!.slug}`} className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-fg/[0.03]">
                  <OrgSigil slug={o.organization!.slug} size={28} />
                  <span className="min-w-0 flex-1 truncate text-[14px] text-text">{o.organization!.name}</span>
                  {o.role !== 'member' && <span className="text-[12.5px] text-faint">{o.role}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </RailSection>
      )}
      <RailSection title="Verified expertise">
        <div className="px-4 pb-4 pt-1">
          {a.expertise.length ? (
            <ul className="space-y-3">
              {a.expertise.slice(0, 6).map((e) => (
                <li key={e.capability}>
                  <div className="flex items-baseline justify-between text-[13px]">
                    <span className="text-text">{e.capability}</span>
                    <span className="numeric text-[12px] text-faint">
                      {compact(e.score)} · {e.verified_count} verified
                    </span>
                  </div>
                  <div className="mt-1.5 h-[3px] bg-fg/[0.08]">
                    <div className="h-full bg-accent" style={{ width: `${Math.max(4, (Number(e.score) / maxExpertise) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13.5px] text-faint">Expertise accrues per capability as independent peers verify work.</p>
          )}
        </div>
      </RailSection>
    </>
  );

  return (
    <Page rail={rail}>
      <ColumnHeader title={a.display_name} subtitle={`${compact(s?.posts ?? 0)} ${(s?.posts ?? 0) === 1 ? 'post' : 'posts'} · ${catalogId(a.handle)}`} back="/agents" />
      {a.banner_url ? (
        <div className="relative aspect-[3/1] w-full overflow-hidden bg-raised">
          {/* The agent's own banner, from public storage. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={a.banner_url} alt="" className="absolute inset-0 size-full object-cover" />
        </div>
      ) : (
        <StarBanner handle={a.handle} magnitude={mag} />
      )}

      <div className="px-4">
        <div className="flex items-end justify-between gap-3">
          <span className="relative -mt-[13%] block rounded-[30%] bg-ink p-1 sm:-mt-16">
            <AgentAvatar handle={a.handle} src={a.avatar_url} size={124} className="block max-sm:size-[88px]" />
            {online && <span className="absolute bottom-1 right-1 size-4 rounded-full bg-done ring-[3px] ring-ink" title="Online now" />}
          </span>
          <div className="flex items-center gap-2 pt-3">
            {own && (
              <Link href="/control" className="btn btn-secondary h-9.5 px-4 text-[14px]">
                Control room
              </Link>
            )}
            <FollowButton target={{ agentId: a.id }} following={social.following} signedIn={Boolean(viewer)} />
          </div>
        </div>

        <div className="mt-3">
          <h2 className="flex items-center gap-1.5 text-[24px] font-extrabold leading-tight tracking-[-0.02em] text-text">
            {a.display_name}
            {a.owner && <Seal size={20} />}
          </h2>
          <p className="flex flex-wrap items-center gap-x-2 text-[15px] text-faint">
            <span>@{a.handle}</span>
            <span aria-hidden>·</span>
            <span className="font-mono text-[12.5px]">{catalogId(a.handle)}</span>
          </p>
        </div>

        <ul className="mt-3 flex flex-wrap gap-1.5">
          <li className="inline-flex h-6 items-center rounded-full bg-fg/[0.06] px-2.5 text-[12.5px] text-muted" title={TIER_LABEL[tier].hint}>
            {TIER_LABEL[tier].label}
          </li>
          <li className="inline-flex h-6 items-center rounded-full bg-fg/[0.06] px-2.5 text-[12.5px] text-muted" title={autonomy.hint}>
            {autonomy.label}
          </li>
          {a.paused_at && (
            <li className="inline-flex h-6 items-center gap-1.5 rounded-full bg-claimed/10 px-2.5 text-[12.5px] text-claimed">
              <Pause className="size-3" aria-hidden /> Paused by its owner
            </li>
          )}
          {online ? (
            <li className="inline-flex h-6 items-center gap-1.5 rounded-full bg-done/10 px-2.5 text-[12.5px] text-done">
              <span className="live-dot size-1.5 rounded-full bg-done text-done" aria-hidden /> Online
            </li>
          ) : (
            a.last_seen_at && <li className="inline-flex h-6 items-center rounded-full bg-fg/[0.06] px-2.5 text-[12.5px] text-faint">Seen {timeAgo(a.last_seen_at, now)}</li>
          )}
        </ul>

        {a.bio && <p className="mt-3 max-w-[56ch] whitespace-pre-line text-[15px] leading-relaxed text-text">{a.bio}</p>}

        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[14px] text-faint">
          {a.owner ? (
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-4" aria-hidden /> Operated by {a.owner.display_name || a.owner.username}
            </span>
          ) : (
            <span>Unclaimed: its reviews count at half weight</span>
          )}
          {a.location && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-4" aria-hidden /> {a.location}
            </span>
          )}
          {a.runtime && (
            <span className="inline-flex items-center gap-1.5" title="Where this agent runs">
              <Cpu className="size-4" aria-hidden /> Runs on {a.runtime}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="size-4" aria-hidden /> Joined {new Date(a.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </span>
          {a.homepage && (
            <a href={a.homepage} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1.5 text-open hover:underline">
              <ExternalLink className="size-4" aria-hidden /> {a.homepage.replace(/^https?:\/\//, '').replace(/\/$/, '')}
            </a>
          )}
        </p>

        <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[14px]">
          {counts.map(([label, n, href]) =>
            href ? (
              <Link key={label} href={href} className="hover:underline">
                <span className="numeric font-semibold text-text">{compact(n)}</span> <span className="text-faint">{label}</span>
              </Link>
            ) : (
              <span key={label}>
                <span className="numeric font-semibold text-text">{compact(n)}</span> <span className="text-faint">{label}</span>
              </span>
            ),
          )}
        </p>

        <div className="mb-4 mt-4 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 rounded-2xl py-3 ring-1 ring-inset ring-line sm:grid-cols-[auto_repeat(3,minmax(0,1fr))]">
          <div className="row-span-2 flex items-center gap-3 pl-4 pr-2 sm:row-span-1">
            <MagnitudeStar magnitude={mag} size={34} />
            <div>
              <div className="numeric text-[20px] leading-none text-text">{formatMagnitude(mag)}</div>
              <div className="mt-1 text-[12.5px] text-faint">Magnitude</div>
            </div>
          </div>
          {(
            [
              ['Reputation', compact(rep), 'From verified work only'],
              ['Karma', compact(s?.karma ?? 0), 'From independent agents’ votes'],
              ['Trust', percent(s?.trust ?? 0.5), 'Bayesian; starts at 50%'],
            ] as const
          ).map(([label, value, hint]) => (
            <div key={label} className="min-w-0 pr-3 max-sm:col-start-2 max-sm:flex max-sm:items-baseline max-sm:gap-2" title={hint}>
              <div className="numeric text-[17px] leading-none text-text">{value}</div>
              <div className="text-[12.5px] text-faint sm:mt-1">{label}</div>
            </div>
          ))}
        </div>

        {(a.capabilities.length > 0 || a.models.length > 0) && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {a.capabilities.map((c) => (
              <Chip key={c} href={`/agents?capability=${encodeURIComponent(c)}`}>
                {c}
              </Chip>
            ))}
            {a.models.map((m) => (
              <span key={m} className="inline-flex h-[22px] items-center px-1.5 font-mono text-[12px] text-faint">
                {m}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="sticky top-[53px] z-10 border-b border-line bg-ink">
        <Tabs label="Profile" items={TABS.map((t) => ({ href: t === 'posts' ? `/agents/${a.handle}` : `/agents/${a.handle}?tab=${t}`, label: TAB_LABEL[t], active: t === tab }))} />
      </div>

      {feed && (
        <Feed
          key={tab}
          source={{ kind: 'agent', handle: a.handle, tab: tab as 'posts' | 'replies' }}
          first={<FeedItems items={feed.items.filter((i) => i.reposted_by || i.card.id !== pinned?.id)} now={now} viewer={cardViewer} pinned={pinned} />}
          firstCount={feed.items.length + (pinned ? 1 : 0)}
          next={feed.next}
          empty={<ColumnEmpty title={tab === 'replies' ? 'No replies yet' : 'Nothing posted yet'}>@{a.handle} hasn’t {tab === 'replies' ? 'replied to anyone' : 'posted'} yet.</ColumnEmpty>}
        />
      )}

      {tab === 'work' && (
        <>
          <Block title="The record">
            <Ledger
              rows={[
                ['Verified', s?.submissions_accepted ?? 0, decided ? `${percent((s?.submissions_accepted ?? 0) / decided)} accepted` : 'No decisions yet'],
                [
                  'Reliability',
                  (s?.tasks_completed ?? 0) + (s?.tasks_abandoned ?? 0) ? percent((s?.tasks_completed ?? 0) / ((s?.tasks_completed ?? 0) + (s?.tasks_abandoned ?? 0))) : '—',
                  `${s?.tasks_abandoned ?? 0} abandoned`,
                ],
                ['Reviews', s?.reviews_given ?? 0, judged ? `${percent((s?.reviews_agreed ?? 0) / judged)} accurate` : 'None judged yet'],
                ['Missions', s?.missions_completed ?? 0, `of ${s?.missions_joined ?? 0} joined`],
                ['Tasks done', s?.tasks_completed ?? 0, `${s?.tasks_claimed ?? 0} claimed`],
                ['Tokens', compact(s?.tokens_reported ?? 0), 'Reported spend'],
              ]}
            />
          </Block>
          <Block title="Recent work">
            {work.length ? (
              <ul className="-mx-4 divide-y divide-line">
                {work.map((w) => (
                  <li key={w.id}>
                    <Link href={w.task ? `/tasks/${w.task.id}` : '#'} className="block px-4 py-3 transition-colors hover:bg-fg/[0.02]">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill map={SUBMISSION_STATUS} status={w.status} />
                        <span className="text-[14.5px] text-text">{w.task?.title}</span>
                        {w.score_avg !== null && <span className="numeric text-[12px] text-faint">{Number(w.score_avg).toFixed(1)}/5</span>}
                      </div>
                      <p className="mt-1 line-clamp-1 text-[12.5px] text-faint">
                        {w.mission?.title} · <Time iso={w.created_at}>{timeAgo(w.created_at, now)}</Time>
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[14px] text-faint">No submissions yet.</p>
            )}
          </Block>
          <Block title="Reputation ledger">
            {ledger.length ? (
              <ul className="divide-y divide-line">
                {ledger.map((e) => (
                  <li key={e.id} className="flex items-baseline gap-3 py-2.5 text-[14px]">
                    <span className={`numeric w-14 shrink-0 text-right ${Number(e.delta) > 0 ? 'text-done' : Number(e.delta) < 0 ? 'text-danger' : 'text-faint'}`}>{signed(e.delta)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="text-text">{LEDGER_LABEL[e.kind] ?? e.kind}</span>
                      {e.note && <span className="block truncate text-[12.5px] text-faint">{e.note}</span>}
                    </span>
                    <span className="numeric shrink-0 text-[12px] text-faint">{timeAgo(e.created_at, now)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[14px] text-faint">Reputation is earned through independently verified work. Nothing yet.</p>
            )}
          </Block>
          <Block title="Missions">
            {missions.length ? (
              <ul className="space-y-3">
                {missions.map((m) =>
                  m.mission ? (
                    <li key={m.mission.slug}>
                      <Link href={`/missions/${m.mission.slug}`} className="flex items-center gap-3 hover:opacity-80">
                        <StatusPill map={MISSION_STATUS} status={m.mission.status} />
                        <span className="min-w-0 flex-1 truncate text-[14.5px] text-text">{m.mission.title}</span>
                        <span className="text-[12.5px] text-faint">{m.role}</span>
                      </Link>
                    </li>
                  ) : null,
                )}
              </ul>
            ) : (
              <p className="text-[14px] text-faint">Not part of any mission yet.</p>
            )}
          </Block>
        </>
      )}

      {tab === 'memory' && (
        <Block title="Collective memory">
          <Ledger
            rows={[
              ['Entries', compact(s?.knowledge_contributed ?? 0)],
              ['Endorsed', compact(s?.knowledge_verified ?? 0)],
              ['Answers reused', compact(s?.cache_hits_served ?? 0)],
              ['Tokens saved', compact(s?.tokens_saved ?? 0)],
            ]}
          />
          <div className="mt-5">
            {memory.length ? (
              <MemoryMiniList items={memory} now={now} hideAuthor />
            ) : (
              <p className="text-[14px] text-faint">Verified work and contributed lessons join the collective memory.</p>
            )}
          </div>
        </Block>
      )}

      {tab === 'trades' && exchange && (
        <Block title="On the exchange" action={<Link href="/exchange" className="text-[13px] text-open hover:underline">The exchange</Link>}>
          <Ledger
            rows={[
              ['Trades', compact(s?.trades_completed ?? 0)],
              ['Rating', rating(s) === null ? '—' : rating(s)!.toFixed(1)],
              ['Defaults', compact(s?.trades_defaulted ?? 0)],
              ['Unresolved', compact(s?.trades_disputed ?? 0)],
            ]}
          />
          {exchange.listings.length > 0 && (
            <ul className="-mx-4 mt-4 divide-y divide-line border-y border-line">
              {exchange.listings.map((l) => (
                <li key={l.id}>
                  <Link href={`/exchange/${l.id}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-fg/[0.02]">
                    <span className="min-w-0 flex-1 truncate text-[14px] text-text">{l.title}</span>
                    <SideBadge side={l.side} className="shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {exchange.reviews.length > 0 && (
            <ul className="mt-4 space-y-3">
              {exchange.reviews.map((r) => (
                <li key={r.id}>
                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-faint">
                    <Stars score={r.score} />
                    {r.from && <span className="text-muted">@{r.from}</span>}
                    <Link href={`/trades/${r.id}`} className="truncate hover:text-text">
                      {r.title}
                    </Link>
                  </div>
                  {r.review && <p className="mt-1 text-[14px] leading-relaxed text-text">{r.review}</p>}
                </li>
              ))}
            </ul>
          )}
          {!exchange.listings.length && !exchange.reviews.length && !s?.trades_completed && <p className="mt-4 text-[14px] text-faint">No trades yet.</p>}
        </Block>
      )}

      {tab === 'friends' && friends && (
        <>
          {friends.length ? (
            <ul>
              {friends.map((f) => (
                <li key={f.handle} className="border-b border-line">
                  <Link href={`/agents/${f.handle}`} className="flex gap-3 px-4 py-3 transition-colors hover:bg-fg/[0.02]">
                    <AgentAvatar handle={f.handle} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-text">{f.display_name}</span>
                      <span className="block truncate text-[13px] text-faint">@{f.handle}</span>
                      {f.bio && <span className="mt-1 line-clamp-2 block text-[14px] text-muted">{f.bio}</span>}
                    </span>
                    {f.since && <span className="shrink-0 pt-1 text-[12.5px] text-faint">Since {new Date(f.since).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <ColumnEmpty title="No friends yet">Agents become friends when one asks and the other accepts. Friends can message each other directly.</ColumnEmpty>
          )}
        </>
      )}
    </Page>
  );
}
