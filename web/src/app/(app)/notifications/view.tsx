// The notification center: what waits for you, what your agents did, and the rest, newest first and grouped by day.
import { Bell, CircleCheck, UserCheck } from 'lucide-react';
import Link from 'next/link';
import { NoticeRow } from '@/components/notices';
import { noticeMeta, type NoticeGroup } from '@/components/notice-kinds';
import { LiveRefresh } from '@/components/live';
import { ColumnHeader, Page, Tabs } from '@/components/shell/column';
import { DefaultRail } from '@/components/shell/rail';
import { markAllRead } from '@/app/(app)/control/actions';
import { buttonClass } from '@/components/ui';
import type { Notice } from '@/lib/notice-href';
import type { Viewer } from '@/lib/viewer';

export const NOTICE_TABS = [
  { value: 'all', label: 'All' },
  { value: 'decision', label: 'Needs you' },
  { value: 'agents', label: 'Agents' },
  { value: 'updates', label: 'Updates' },
] as const;

export interface NotificationsViewProps {
  notices: Notice[];
  tab: string;
  now: number;
  viewer: Viewer;
  /** True when more notices exist than were loaded. */
  more: boolean;
  /** Link that loads more, kept to the current tab. */
  moreHref: string;
}

const DAY = 86_400_000;
const dayStart = (t: number) => Math.floor(t / DAY) * DAY;

function dayLabel(iso: string, now: number) {
  const days = Math.round((dayStart(now) - dayStart(Date.parse(iso))) / DAY);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

const EMPTY: Record<string, { title: string; body: string }> = {
  all: { title: 'You’re all caught up', body: 'When your agents ask for a decision, finish a mission or need you, it lands here. Everything else, they handle.' },
  decision: { title: 'Nothing needs you', body: 'Approvals, review requests and anything an agent can’t do without you wait here.' },
  agents: { title: 'No agent news', body: 'New agents joining and replies to your directives show up here.' },
  updates: { title: 'No updates', body: 'Finished missions, replies to your agents and GitHub changes show up here.' },
};

function hrefFor(tab: string, extra = '') {
  return `/notifications${tab === 'all' ? '' : `?tab=${tab}`}${extra}`;
}

export function NotificationsView({ notices, tab, now, viewer, more, moreHref }: NotificationsViewProps) {
  const inGroup = (n: Notice, group: NoticeGroup) => noticeMeta(n.kind).group === group;
  const shown = tab === 'all' ? notices : notices.filter((n) => inGroup(n, tab as NoticeGroup));
  const unread = notices.filter((n) => !n.read_at).length;
  const waiting = notices.filter((n) => !n.read_at && inGroup(n, 'decision')).length;

  const days: { label: string; items: Notice[] }[] = [];
  for (const n of shown) {
    const label = dayLabel(n.created_at, now);
    const last = days.at(-1);
    if (last?.label === label) last.items.push(n);
    else days.push({ label, items: [n] });
  }

  const empty = EMPTY[tab] ?? EMPTY.all;
  const count = (group: NoticeGroup) => notices.filter((n) => !n.read_at && inGroup(n, group)).length;

  return (
    <Page rail={<DefaultRail viewer={viewer} />}>
      <ColumnHeader
        title="Notifications"
        subtitle={unread ? `${unread} unread${waiting ? ` · ${waiting} waiting on you` : ''}` : 'All caught up'}
        right={
          unread > 0 && (
            <form action={markAllRead}>
              <button type="submit" className={buttonClass('secondary', 'sm')}>
                <CircleCheck className="size-3.5" aria-hidden /> Mark all read
              </button>
            </form>
          )
        }
      >
        <Tabs
          label="Filter notifications"
          items={NOTICE_TABS.map((t) => {
            const n = t.value === 'all' ? unread : count(t.value);
            return {
              href: hrefFor(t.value),
              active: tab === t.value,
              label: (
                <span className="flex items-center gap-1.5">
                  {t.label}
                  {n > 0 && <span className="numeric rounded-full bg-accent/15 px-1.5 text-[12px] font-semibold leading-[18px] text-accent">{n}</span>}
                </span>
              ),
            };
          })}
        />
      </ColumnHeader>

      {waiting > 0 && tab === 'all' && (
        <Link href="/notifications?tab=decision" className="flex items-center gap-3 border-b border-line bg-accent/[0.06] px-4 py-3 transition-colors hover:bg-accent/10">
          <UserCheck className="size-[18px] shrink-0 text-accent" aria-hidden />
          <span className="min-w-0 flex-1 text-[14.5px] text-text">
            <span className="font-semibold">{waiting === 1 ? '1 thing is' : `${waiting} things are`} waiting on you.</span> <span className="text-muted">Your agents can’t go on without it.</span>
          </span>
          <span className="shrink-0 text-[13.5px] font-medium text-accent">Open</span>
        </Link>
      )}

      {days.length ? (
        <>
          {days.map((d) => (
            <section key={d.label} aria-label={d.label}>
              <h2 className="border-b border-line bg-fg/[0.025] px-4 py-2 text-[13px] font-semibold text-faint">{d.label}</h2>
              <ol>
                {d.items.map((n) => (
                  <NoticeRow key={n.id} notice={n} now={now} />
                ))}
              </ol>
            </section>
          ))}
          {more && (
            <Link href={moreHref} className="block px-4 py-5 text-center text-[14.5px] font-medium text-open transition-colors hover:bg-fg/[0.03]">
              Show older notifications
            </Link>
          )}
        </>
      ) : (
        <div className="px-8 py-16 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-fg/[0.06]">
            <Bell className="size-5 text-faint" aria-hidden />
          </span>
          <p className="mt-4 text-[22px] font-bold tracking-[-0.02em] text-text">{empty.title}</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[15px] leading-relaxed text-faint">{empty.body}</p>
        </div>
      )}
      <LiveRefresh channel={`notices:${viewer.id}`} watch={[{ table: 'notifications', filter: `user_id=eq.${viewer.id}` }]} showBadge={false} />
    </Page>
  );
}
