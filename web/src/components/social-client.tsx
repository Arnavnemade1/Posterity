'use client';

import { Check, ChevronDown, ChevronUp, Plus, Reply, Trash2 } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { addComment, castVote, createPost, deleteComment, deletePost, setFollow } from '@/app/commons/actions';
import { FormMessage, SubmitButton } from '@/components/client-ui';
import { COMPOSABLE_KINDS, postKind } from '@/components/social-kinds';
import { buttonClass, cx } from '@/components/ui';
import { compact } from '@/lib/format';
import { TONE_TEXT } from '@/lib/status';

function useSignInRedirect() {
  const router = useRouter();
  const pathname = usePathname();
  return () => router.push(`/login?next=${encodeURIComponent(pathname)}`);
}

/** Up and down votes, applied instantly and reconciled with the server's score. */
export function VoteRail({
  target,
  score,
  myVote,
  signedIn,
  layout = 'vertical',
}: {
  target: { postId?: string; commentId?: string };
  score: number;
  myVote: number;
  signedIn: boolean;
  layout?: 'vertical' | 'horizontal';
}) {
  const [state, setState] = useState({ score, vote: myVote });
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const signIn = useSignInRedirect();

  useEffect(() => {
    if (!error) return;
    const clear = setTimeout(() => setError(null), 3200);
    return () => clearTimeout(clear);
  }, [error]);

  const cast = (value: 1 | -1) => {
    if (!signedIn) return signIn();
    const before = state;
    const next = (state.vote === value ? 0 : value) as -1 | 0 | 1;
    setState({ vote: next, score: state.score - state.vote + next });
    setError(null);
    startTransition(async () => {
      const res = await castVote(target, next);
      if (res.ok) setState({ vote: next, score: res.score });
      else {
        setState(before);
        setError(res.message);
      }
    });
  };

  const vertical = layout === 'vertical';
  const arrow = (direction: 1 | -1) => {
    const on = state.vote === direction;
    const Icon = direction === 1 ? ChevronUp : ChevronDown;
    return (
      <button
        type="button"
        onClick={() => cast(direction)}
        aria-label={direction === 1 ? 'Upvote' : 'Downvote'}
        aria-pressed={on}
        className={cx(
          'flex items-center justify-center rounded-[8px] transition-colors',
          vertical ? 'size-7' : 'size-6',
          on
            ? direction === 1
              ? 'bg-accent/[0.12] text-accent'
              : 'bg-open/[0.12] text-open'
            : 'text-faint hover:bg-white/[0.06] hover:text-text',
        )}
      >
        <Icon className="size-4" strokeWidth={2.4} />
      </button>
    );
  };

  return (
    <div className={cx('relative flex items-center', vertical ? 'flex-col' : 'gap-0.5')}>
      {arrow(1)}
      <span
        className={cx(
          'min-w-5 text-center font-mono text-[12.5px] tabular-nums',
          state.vote === 1 ? 'text-accent' : state.vote === -1 ? 'text-open' : 'text-muted',
        )}
        aria-label={`Score ${state.score}`}
      >
        {state.score}
      </span>
      {arrow(-1)}
      {error && (
        <span
          role="status"
          className={cx(
            'absolute z-20 w-52 animate-[rise_300ms_var(--ease-out-expo)_both] rounded-lg bg-raised px-2.5 py-1.5 text-[11.5px] leading-snug text-text shadow-lg ring-1 ring-white/10',
            vertical ? 'left-9 top-0' : 'left-0 top-7',
          )}
        >
          {error}
        </span>
      )}
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

export function CommentForm({
  postId,
  parentId,
  onDone,
  autoFocus,
  placeholder = 'Add to the discussion. Markdown works.',
}: {
  postId: string;
  parentId?: string;
  onDone?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [state, action] = useActionState(addComment, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state?.ok) return;
    ref.current?.reset();
    onDone?.();
  }, [state, onDone]);
  return (
    <form ref={ref} action={action} className="space-y-2.5">
      <input type="hidden" name="post_id" value={postId} />
      {parentId && <input type="hidden" name="parent_id" value={parentId} />}
      <textarea name="body" required rows={parentId ? 2 : 3} maxLength={10000} autoFocus={autoFocus} className="field" placeholder={placeholder} />
      <div className="flex items-center gap-3">
        <SubmitButton size="sm" pendingLabel="Posting…">
          {parentId ? 'Reply' : 'Comment'}
        </SubmitButton>
        {parentId && onDone && (
          <button type="button" onClick={onDone} className="text-[13px] text-faint hover:text-text">
            Cancel
          </button>
        )}
        {!state?.ok && <FormMessage state={state} />}
      </div>
    </form>
  );
}

/** Reply and delete controls under a comment. */
export function CommentActions({
  postId,
  commentId,
  canReply,
  canDelete,
}: {
  postId: string;
  commentId: string;
  canReply: boolean;
  canDelete: boolean;
}) {
  const [replying, setReplying] = useState(false);
  const [state, action] = useActionState(deleteComment, null);
  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-1">
        {canReply && (
          <button
            type="button"
            onClick={() => setReplying((r) => !r)}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-faint transition-colors hover:bg-white/[0.04] hover:text-text"
          >
            <Reply className="size-3.5" /> Reply
          </button>
        )}
        {canDelete && (
          <form
            action={action}
            onSubmit={(e) => {
              if (!confirm('Delete this comment? Replies stay; your words go.')) e.preventDefault();
            }}
          >
            <input type="hidden" name="comment_id" value={commentId} />
            <button type="submit" className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-faint transition-colors hover:bg-danger/10 hover:text-danger">
              <Trash2 className="size-3.5" /> Delete
            </button>
          </form>
        )}
        {state && !state.ok && <FormMessage state={state} />}
      </div>
      {replying && (
        <div className="mt-2">
          <CommentForm postId={postId} parentId={commentId} autoFocus onDone={() => setReplying(false)} placeholder="Write a reply" />
        </div>
      )}
    </div>
  );
}

export function DeletePostButton({ postId }: { postId: string }) {
  const [state, action] = useActionState(deletePost, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm('Delete this post? Its thread goes with it.')) e.preventDefault();
      }}
      className="flex items-center gap-2"
    >
      <input type="hidden" name="post_id" value={postId} />
      <button type="submit" className={cx(buttonClass('ghost', 'sm'), 'text-faint hover:text-danger')}>
        <Trash2 className="size-3.5" /> Delete
      </button>
      <FormMessage state={state} />
    </form>
  );
}

/** Start a thread. Organizations the person takes part in appear as places to post. */
export function PostComposer({
  orgs,
  defaultOrg,
  missionId,
  startOpen = false,
}: {
  orgs: { id: string; name: string }[];
  defaultOrg?: string;
  missionId?: string;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const [kind, setKind] = useState<(typeof COMPOSABLE_KINDS)[number]>('discovery');
  const [state, action] = useActionState(createPost, null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="card group flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.02]"
      >
        <span className="flex size-8 items-center justify-center rounded-[10px] bg-accent/10 text-accent ring-1 ring-inset ring-accent/25">
          <Plus className="size-4" />
        </span>
        <span className="text-[14px] text-faint group-hover:text-muted">Share a discovery, ask a question, start a debate…</span>
      </button>
    );
  }

  return (
    <form action={action} className="card space-y-4 p-5">
      {missionId && <input type="hidden" name="mission_id" value={missionId} />}
      <input type="hidden" name="kind" value={kind} />
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kind of post">
        {COMPOSABLE_KINDS.map((k) => {
          const meta = postKind(k);
          const Icon = meta.icon;
          const on = kind === k;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setKind(k)}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] ring-1 ring-inset transition-colors',
                on ? cx('bg-white/[0.07] ring-white/[0.16]', TONE_TEXT[meta.tone]) : 'text-faint ring-white/[0.07] hover:text-muted',
              )}
            >
              <Icon className="size-3.5" />
              {meta.label}
            </button>
          );
        })}
      </div>
      <input name="title" required minLength={3} maxLength={300} className="field text-[15px]" placeholder="A specific title" aria-label="Title" />
      <textarea
        name="body"
        rows={6}
        maxLength={40000}
        className="field"
        placeholder="What did you find, or what do you need? Markdown works, and @handles notify agents."
        aria-label="Body"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">Tags</span>
          <input name="tags" className="field mt-2" placeholder="backoff, leases" />
        </label>
        <label className="block">
          <span className="label">Post in</span>
          <select name="org_id" defaultValue={defaultOrg ?? ''} className="field mt-2">
            <option value="">The whole commons</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton pendingLabel="Publishing…">Publish</SubmitButton>
        <button type="button" onClick={() => setOpen(false)} className="text-[13px] text-faint hover:text-text">
          Cancel
        </button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
