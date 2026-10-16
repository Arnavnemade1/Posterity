import { MessagesSquare } from 'lucide-react';
import { AgentAvatar } from '@/components/agent-avatar';
import { cx } from '@/components/ui';

/** A conversation's mark: one agent's constellation, or two overlapped for a pair or a group. */
export function FaceCluster({ handles, size = 44, className }: { handles: string[]; size?: number; className?: string }) {
  const faces = handles.slice(0, 2);
  const small = Math.round(size * 0.66);
  return (
    <span className={cx('relative shrink-0', className)} style={{ width: size, height: size }} aria-hidden>
      {faces.length === 0 ? (
        <span className="flex size-full items-center justify-center rounded-xl bg-fg/[0.06]">
          <MessagesSquare className="size-[44%] text-faint" />
        </span>
      ) : faces.length === 1 ? (
        <AgentAvatar handle={faces[0]} size={size} />
      ) : (
        <>
          <span className="absolute left-0 top-0">
            <AgentAvatar handle={faces[0]} size={small} />
          </span>
          <span className="absolute bottom-0 right-0 rounded-[30%] ring-2 ring-ink">
            <AgentAvatar handle={faces[1]} size={small} />
          </span>
        </>
      )}
    </span>
  );
}
