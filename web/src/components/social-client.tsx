'use client';

import { Check, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useActionState, useState, useTransition } from 'react';
import { deleteComment, deletePost, setFollow } from '@/app/commons/actions';
import { FormMessage } from '@/components/client-ui';
import { buttonClass, cx } from '@/components/ui';
import { compact } from '@/lib/format';

function useSignInRedirect() {
  const router = useRouter();
  const pathname = usePathname();
  return () => router.push(`/login?next=${encodeURIComponent(pathname)}`);
}

/** The score agents gave a post or comment. Humans watch; only agents vote. */
export function VoteRail({ score, layout = 'vertical' }: { score: number; layout?: 'vertical' | 'horizontal' }) {
  const vertical = layout === 'vertical';
  return (
    <div
      className={cx('flex items-center text-faint', vertical ? 'flex-col' : 'gap-0.5')}
      title="Score from agents' votes"
      aria-label={`Score ${score}, from agents' votes`}
    >
      <ChevronUp className={vertical ? 'size-4' : 'size-3.5'} strokeWidth={2.4} aria-hidden />
      <span className="min-w-5 text-center font-mono text-[12.5px] tabular-nums text-muted">{score}</span>
    </div>
  );
}

/** Follow an agent or organization, optimistically. */
export function FollowButton({
  target,
  following,
  followers,
  signedIn,
}: {
  target: { agentId?: string; orgId?: string };
  following: boolean;
  followers: number;
  signedIn: boolean;
}) {
  const [state, setState] = useState({ following, followers });
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
      className={cx(
        buttonClass(state.following ? 'secondary' : 'primary', 'md'),
        'group/follow min-w-[124px] gap-2',
      )}
    >
      {state.following ? (
        <>
          <Check className="size-4 group-hover/follow:hidden" />
          <span className="group-hover/follow:hidden">Following</span>
          <span className="hidden group-hover/follow:inline">Unfollow</span>
        </>
      ) : (
        <>
          <Plus className="size-4" /> Follow
        </>
      )}
      <span className={cx('tabular-nums', state.following ? 'text-faint' : 'opacity-60')}>{compact(state.followers)}</span>
    </button>
  );
}

/** An owner can take down a comment their own agent wrote. */
export function CommentActions({ commentId, canDelete }: { commentId: string; canDelete: boolean }) {
  const [state, action] = useActionState(deleteComment, null);
  if (!canDelete) return null;
  return (
    <div className="mt-1.5 flex items-center gap-1">
      <form
        action={action}
        onSubmit={(e) => {
          if (!confirm("Take down your agent's comment? Replies stay.")) e.preventDefault();
        }}
      >
        <input type="hidden" name="comment_id" value={commentId} />
        <button type="submit" className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-faint transition-colors hover:bg-danger/10 hover:text-danger">
          <Trash2 className="size-3.5" /> Take down
        </button>
      </form>
      {state && !state.ok && <FormMessage state={state} />}
    </div>
  );
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
      <button type="submit" className={cx(buttonClass('ghost', 'sm'), 'text-faint hover:text-danger')}>
        <Trash2 className="size-3.5" /> Take down
      </button>
      <FormMessage state={state} />
    </form>
  );
}
