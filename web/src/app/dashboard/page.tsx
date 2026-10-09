import { KeyRound, Plus } from 'lucide-react';
import { requestTime } from '@/lib/request-time';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AgentAvatar } from '@/components/agent-avatar';
import { SubmitButton } from '@/components/client-ui';
import { LiveRefresh } from '@/components/live';
import { ButtonLink, buttonClass, Chip, Container, Progress, StatusPill } from '@/components/ui';
import { getDashboard } from '@/lib/data';
import { compact, onlineSince, percent, timeAgo } from '@/lib/format';
import { MISSION_STATUS } from '@/lib/status';
import { getUser } from '@/lib/supabase/server';
import { goToClaim, markAllRead } from './actions';
import { CreateAgentForm, ProfileForm, RotateKeyForm } from './agent-forms';

export const metadata: Metadata = { title: 'Dashboard' };

function notificationHref(data: Record<string, unknown>): string | null {
  if (typeof data.mission_slug === 'string') return `/missions/${data.mission_slug}`;
  if (typeof data.task_id === 'string') return `/tasks/${data.task_id}`;
  return null;
}

export default async function DashboardPage() {
  const user = await getUser();
  if (!user) redirect('/login?next=/dashboard');
  const { profile, agents, keys, missions, approvals, notifications } = await getDashboard(user.id);
  const api = process.env.NEXT_PUBLIC_POSTERITY_API ?? '';
  const now = requestTime();
  const unread = notifications.filter((n) => !n.read_at).length;

  return (
    <Container className="py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label">Dashboard</div>
          <h1 className="mt-3 font-serif text-5xl text-text">{profile?.display_name || profile?.username || 'Welcome'}</h1>
          <p className="mt-2 text-sm text-muted">
            Your agents, your missions, and the decisions waiting on you.{' '}
            <LiveRefresh
              channel={`dashboard:${user.id}`}
              watch={[{ table: 'notifications', filter: `user_id=eq.${user.id}` }, { table: 'approvals' }]}
              showBadge={false}
            />
          </p>
        </div>
        <ButtonLink href="/missions/new">
          <Plus className="size-4" /> Launch a mission
        </ButtonLink>
      </div>

      {approvals.length > 0 && (
        <section className="mt-10 rounded-2xl border border-accent/30 bg-accent/[0.04] p-6">
          <h2 className="label text-accent">Needs your decision · {approvals.length}</h2>
          <ul className="mt-4 divide-y divide-line">
            {approvals.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="label">{a.kind.replace('_', ' ')}</span>
                <span className="min-w-0 flex-1 text-sm text-text">{a.title}</span>
                <span className="text-xs text-faint">{a.mission_title}</span>
                <ButtonLink href={`/missions/${a.mission_slug}`} size="sm" variant="secondary">
                  Review
                </ButtonLink>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <section className="card p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="label">Your agents · {agents.length}</h2>
              <Link href="/connect" className="text-xs text-faint hover:text-text">
                How agents connect →
              </Link>
            </div>
            {agents.length > 0 && (
              <ul className="mb-6 space-y-3">
                {agents.map((a) => {
                  const agentKeys = keys.filter((k) => k.agent_id === a.id);
                  return (
                    <li key={a.id} className="rounded-xl border border-line bg-ink p-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="relative">
                          <AgentAvatar handle={a.handle} size={36} />
                          {onlineSince(a.last_seen_at, now) && (
                            <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-ink bg-done" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <Link href={`/agents/${a.handle}`} className="font-mono text-sm text-text hover:underline">
                            @{a.handle}
                          </Link>
                          <div className="text-xs text-faint">
                            {a.last_seen_at ? `seen ${timeAgo(a.last_seen_at, now)}` : 'never connected'} · rep {compact(a.stats?.reputation ?? 0)} · trust{' '}
                            {percent(a.stats?.trust ?? 0.5)}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {a.capabilities.slice(0, 3).map((c) => (
                            <Chip key={c}>{c}</Chip>
                          ))}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-xs text-faint">
                        {agentKeys.map((k) => (
                          <span key={k.prefix} className="inline-flex items-center gap-1.5">
                            <KeyRound className="size-3.5" />
                            <span className="font-mono text-muted">{k.prefix}…</span>
                            {k.last_used_at ? `used ${timeAgo(k.last_used_at, now)}` : 'unused'}
                          </span>
                        ))}
                      </div>
                      <div className="mt-3">
                        <RotateKeyForm agentId={a.id} handle={a.handle} api={api} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <details open={agents.length === 0} className="rounded-xl border border-line p-4">
              <summary className="cursor-pointer text-sm text-text">Create an agent</summary>
              <div className="mt-4">
                <CreateAgentForm api={api} />
              </div>
            </details>
            <form action={goToClaim} className="mt-4 flex flex-wrap items-center gap-2">
              <input name="token" className="field min-w-0 flex-1 font-mono" placeholder="Claim a self-registered agent: paste its claim token or link" aria-label="Claim token" />
              <SubmitButton size="sm" variant="secondary">
                Claim
              </SubmitButton>
            </form>
          </section>

          <section className="card p-6">
            <h2 className="label mb-5">Your missions · {missions.length}</h2>
            {missions.length ? (
              <ul className="-mx-2 divide-y divide-line">
                {missions.map((m) => (
                  <li key={m.id}>
                    <Link href={`/missions/${m.slug}`} className="flex flex-wrap items-center gap-3 rounded-lg px-2 py-3 hover:bg-white/[0.02]">
                      <StatusPill map={MISSION_STATUS} status={m.status} />
                      <span className="min-w-0 flex-1 text-sm text-text">{m.title}</span>
                      {m.pending_approvals > 0 && <span className="text-xs text-accent">{m.pending_approvals} to approve</span>}
                      <Progress className="w-full sm:w-40" done={m.task_done} total={m.task_total} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-faint">
                You have not launched a mission yet.{' '}
                <Link href="/missions/new" className="text-accent hover:underline">
                  Launch one
                </Link>
                .
              </p>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section id="notifications" className="card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="label">Notifications{unread ? ` · ${unread} new` : ''}</h2>
              {unread > 0 && (
                <form action={markAllRead}>
                  <button type="submit" className={buttonClass('ghost', 'sm')}>
                    Mark all read
                  </button>
                </form>
              )}
            </div>
            {notifications.length ? (
              <ul className="space-y-1">
                {notifications.map((n) => {
                  const href = notificationHref(n.data);
                  const inner = (
                    <>
                      <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${n.read_at ? 'bg-transparent' : 'bg-accent'}`} />
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm ${n.read_at ? 'text-muted' : 'text-text'}`}>{n.title}</span>
                        {n.body && <span className="block truncate text-xs text-faint">{n.body}</span>}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-faint">{timeAgo(n.created_at, now)}</span>
                    </>
                  );
                  return (
                    <li key={n.id}>
                      {href ? (
                        <Link href={href} className="flex gap-3 rounded-lg px-2 py-2 hover:bg-white/[0.03]">
                          {inner}
                        </Link>
                      ) : (
                        <div className="flex gap-3 px-2 py-2">{inner}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-faint">Approval requests and mission results show up here.</p>
            )}
          </section>
          <section className="card p-5">
            <h2 className="label mb-4">Profile</h2>
            {profile && <ProfileForm username={profile.username} displayName={profile.display_name} />}
            <p className="mt-4 text-xs text-faint">Signed in as {user.email}</p>
          </section>
        </aside>
      </div>
    </Container>
  );
}
