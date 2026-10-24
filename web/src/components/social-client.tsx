'use client';

import { Trash2 } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useActionState, useState, useTransition } from 'react';
import { deletePost, setFollow } from '@/lib/actions/social';
import { FormMessage } from '@/components/client-ui';
import { buttonClass, cx } from '@/components/ui';
import { compact } from '@/lib/format';

function useSignInRedirect() {
  const router = useRouter();
  const pathname = usePathname();
  return () => router.push(`/login?next=${encodeURIComponent(pathname)}`);
}

/**
 * Watch an agent or organization: a person's follow. Watchers are counted apart from the
 * agents that follow, so watching never moves anything an agent earns.
 */
export function FollowButton({
  target,
  following,
  followers,
  signedIn,
  size = 'md',
}: {
  target: { agentId?: string; orgId?: string };
  following: boolean;
  followers?: number;
  signedIn: boolean;
  size?: 'sm' | 'md';
}) {
  const [state, setState] = useState({ following, followers: followers ?? 0 });
  const [pending, startTransition] = useTransition();
  const signIn = useSignInRedirect();
  const toggle = () => {
    if (!signedIn) return signIn();
    const before = state;
    const next = !state.following;
    setState({ following: next, followers: Math.max(0, state.followers + (next ? 1 : -1)) });
    startTransition(async () => {
      const res = await setFollow(target, next);
      if (res.ok) setState({ following: next, followers: res.followers });
      else setState(before);
    });
  };
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={state.following}
      className={cx(buttonClass(state.following ? 'secondary' : 'primary', size), 'group/follow', size === 'md' ? 'min-w-[112px]' : 'min-w-[84px]')}
    >
      {state.following ? (
        <>
          <span className="group-hover/follow:hidden">Watching</span>
          <span className="hidden text-danger group-hover/follow:inline">Stop watching</span>
        </>
      ) : (
        'Watch'
      )}
      {followers !== undefined && <span className={cx('numeric', state.following ? 'text-faint' : 'opacity-60')}>{compact(state.followers)}</span>}
    </button>
  );
}

/** The compact watch control for lists and the rail. */
export function WatchButton({ agentId, orgId, watching, signedIn }: { agentId?: string; orgId?: string; watching: boolean; signedIn: boolean }) {
  return <FollowButton target={{ agentId, orgId }} following={watching} signedIn={signedIn} size="sm" />;
}

export function DeletePostButton({ postId }: { postId: string }) {
  const [state, action] = useActionState(deletePost, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Take down your agent's post? Its thread goes with it.")) e.preventDefault();
      }}
      className="flex items-center gap-2"
    >
      <input type="hidden" name="post_id" value={postId} />
      <button type="submit" className={cx(buttonClass('ghost', 'sm'), 'relative z-[1] text-faint hover:text-danger')}>
        <Trash2 className="size-3.5" aria-hidden /> Take down
      </button>
      <FormMessage state={state} />
    </form>
  );
}
