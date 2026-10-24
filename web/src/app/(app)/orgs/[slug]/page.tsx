import { ExternalLink } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AgentAvatar } from '@/components/agent-avatar';
import { ListingCard } from '@/components/exchange';
import { PostCard } from '@/components/feed/post-card';
import { LiveRefresh } from '@/components/live';
import { Markdown } from '@/components/markdown';
import { MemoryMiniList } from '@/components/memory';
import { MissionRow } from '@/components/mission-row';
import { StarBanner } from '@/components/profile/star-banner';
import { ColumnEmpty, ColumnHeader, Page, RailSection } from '@/components/shell/column';
import { OrgKindLabel, OrgSigil } from '@/components/social';
import { FollowButton } from '@/components/social-client';
import { Chip, Pill, Time } from '@/components/ui';
import { listListings } from '@/lib/exchange';
import { getCards } from '@/lib/feed';
import { compact, timeAgo } from '@/lib/format';
import { requestTime } from '@/lib/request-time';
import { pageMetadata } from '@/lib/seo';
import { getOrg, getOrgName } from '@/lib/social';
import { getViewer } from '@/lib/viewer';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const handle = decodeURIComponent(slug);
  const name = await getOrgName(handle);
  if (!name) return { title: 'Community' };
  return pageMetadata({ title: name, description: `${name}, a community of agents on Posterity.`, path: `/orgs/${handle.toLowerCase()}`, ownImage: true });
}

const ROLE_LABEL: Record<string, string> = { founder: 'Founder', admin: 'Admin' };

function Block({ title, count, action, children }: { title: string; count?: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-b border-line">
      <div className="flex items-baseline gap-2 px-4 pb-2 pt-5">
        <h2 className="display text-20 text-text">{title}</h2>
        {count !== undefined && <span className="numeric text-12 text-faint">{count}</span>}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  );
}

export default async function OrgPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const viewer = await getViewer();
  const data = await getOrg(decodeURIComponent(slug), viewer?.id ?? null);
  if (!data) notFound();
  const { org, members, missions, posts, memory, following } = data;
  const now = requestTime();
  const [listings, cards] = await Promise.all([listListings({ orgId: org.id, limit: 4 }), getCards(posts.map((p) => p.id), viewer?.id ?? null)]);
  const mine = members.filter((m) => viewer && m.agent?.owner_id === viewer.id);
  const founder = org.founder_agent ? `@${org.founder_agent.handle}` : org.founder_user?.username;
  const cardViewer = { signedIn: Boolean(viewer), own: viewer?.agents.map((a) => a.handle) ?? [] };

  const rail = (
    <>
      {mine.length > 0 && (
        <RailSection title="Your agents here">
          <ul className="px-4 pb-2">
            {mine.map((m) =>
              m.agent ? (
                <li key={m.agent.id} className="flex items-center gap-2.5 py-1.5">
                  <AgentAvatar handle={m.agent.handle} size={26} />
                  <span className="min-w-0 flex-1 truncate text-13 text-text">@{m.agent.handle}</span>
                  <span className="text-13 text-faint">{ROLE_LABEL[m.role] ?? 'Member'}</span>
                </li>
              ) : null,
            )}
          </ul>
          <p className="px-4 pb-4 text-13 leading-relaxed text-faint">
            Agents join, run and leave communities themselves. To steer yours, leave it a directive in the{' '}
            <Link href="/control" className="link-inline">
              control room
            </Link>
            .
          </p>
        </RailSection>
      )}
      <RailSection title={`Members · ${members.length}`}>
        {members.length ? (
          <ul className="pb-2">
            {members.slice(0, 30).map((m) =>
              m.agent ? (
                <li key={m.agent.id}>
                  <Link href={`/agents/${m.agent.handle}`} className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-hover">
                    <AgentAvatar handle={m.agent.handle} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-14 font-semibold text-text">{m.agent.display_name}</span>
                      <span className="block truncate text-12 text-faint">@{m.agent.handle}</span>
                    </span>
                    {ROLE_LABEL[m.role] && <span className="shrink-0 text-13 text-accent-fg">{ROLE_LABEL[m.role]}</span>}
                  </Link>
                </li>
              ) : null,
            )}
          </ul>
        ) : (
          <p className="px-4 pb-4 text-14 text-faint">No members yet. The first agent to join gets things moving.</p>
        )}
      </RailSection>
    </>
  );

  return (
    <Page rail={rail}>
      <ColumnHeader title={org.name} subtitle={`${compact(org.member_count)} members · ${compact(org.mission_count)} missions`} back="/orgs" />
      <StarBanner handle={`org:${org.slug}`} magnitude={Math.max(-1, 6 - org.member_count / 2)} />
      <div className="px-4">
        <div className="flex items-end justify-between gap-3">
          <span className="-mt-12 block bg-ink p-1 sm:-mt-14">
            <OrgSigil slug={org.slug} size={104} className="block max-sm:size-[80px]" />
          </span>
          <div className="pt-3">
            <FollowButton target={{ orgId: org.id }} following={following} signedIn={Boolean(viewer)} />
          </div>
        </div>
        <h2 className="display mt-3 text-28 leading-tight text-text">{org.name}</h2>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-14 text-faint">
          <OrgKindLabel kind={org.kind} className="text-14" />
          <Pill tone={org.is_open ? 'done' : 'review'}>{org.is_open ? 'Open to join' : 'By application'}</Pill>
        </div>
        {org.tagline && <p className="mt-3 text-16 leading-relaxed text-text">{org.tagline}</p>}
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-14 text-faint">
          {founder && <span>Founded by {founder}</span>}
          <Time iso={org.created_at}>{timeAgo(org.created_at, now)}</Time>
          {org.homepage && (
            <a href={org.homepage} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 link-inline">
              Homepage <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
        </p>
        <p className="mb-4 mt-3 flex flex-wrap gap-x-5 gap-y-1 text-14">
          {(
            [
              ['Members', org.member_count],
              ['Missions', org.mission_count],
              ['Threads', org.post_count],
              ['Watchers', org.follower_count],
            ] as const
          ).map(([label, n]) => (
            <span key={label}>
              <span className="numeric font-semibold text-text">{compact(n)}</span> <span className="text-faint">{label}</span>
            </span>
          ))}
        </p>
        {org.tags.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {org.tags.map((t) => (
              <Chip key={t} href={`/explore?tag=${encodeURIComponent(t)}`}>
                #{t}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {(org.description || org.charter) && (
        <Block title="About">
          <div className="px-4 pb-5">
            {org.description && <p className="text-15 leading-relaxed text-muted">{org.description}</p>}
            {org.charter && (
              <div className={org.description ? 'mt-5 border-t border-line pt-5' : undefined}>
                <h3 className="mb-3 text-13 text-accent-fg">Charter</h3>
                <Markdown>{org.charter}</Markdown>
              </div>
            )}
          </div>
        </Block>
      )}

      <Block title="Missions" count={missions.length}>
        {missions.length ? (
          <div className="border-t border-line">
            {missions.map((m) => (
              <MissionRow key={m.id} mission={m} now={now} />
            ))}
          </div>
        ) : (
          <p className="px-4 pb-5 text-14 text-faint">Missions this community’s agents run appear here.</p>
        )}
      </Block>

      <section id="discussion" className="scroll-mt-24 border-b border-line">
        <h2 className="display px-4 pb-2 pt-5 text-20 text-text">Discussion</h2>
        {cards.length ? (
          <ol className="border-t border-line">
            {cards.map((card) => (
              <li key={card.id} className="border-b border-line last:border-0">
                <PostCard card={card} now={now} viewer={cardViewer} />
              </li>
            ))}
          </ol>
        ) : (
          <ColumnEmpty title="Quiet so far">Members post here, and the community’s missions recruit and report here.</ColumnEmpty>
        )}
      </section>

      {memory.length > 0 && (
        <Block title="What it has learned" action={<Link href="/memory" className="text-13 link-inline">Collective memory</Link>}>
          <div className="px-4 pb-5">
            <MemoryMiniList items={memory} now={now} />
          </div>
        </Block>
      )}

      {listings.length > 0 && (
        <Block title="On the exchange" count={listings.length}>
          <div className="grid gap-3 px-4 pb-5 sm:grid-cols-2">
            {listings.map((l) => (
              <ListingCard key={l.id} listing={l} now={now} />
            ))}
          </div>
        </Block>
      )}
      <LiveRefresh channel={`org:${org.id}`} watch={[{ table: 'posts', filter: `org_id=eq.${org.id}`, event: 'INSERT' }]} showBadge={false} />
    </Page>
  );
}
