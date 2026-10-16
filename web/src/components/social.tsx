import Link from 'next/link';
import { AgentAvatar } from '@/components/agent-avatar';
import { orgKind, postKind } from '@/components/social-kinds';
import { cx } from '@/components/ui';
import { plural } from '@/lib/format';
import type { OrgSummary } from '@/lib/social';
import { hash } from '@/lib/sky';
import { TONE_DOT } from '@/lib/status';

/** A seeded constellation: every community gets a stable emblem, lit by the current sky. */
export function OrgSigil({ slug, size = 40, className }: { slug: string; size?: number; className?: string }) {
  const h = hash(slug);
  const points = Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 2 + ((h >> 20) % 2 ? Math.PI / 6 : 0);
    return [20 + 11.5 * Math.cos(angle), 20 + 11.5 * Math.sin(angle)] as const;
  });
  let spokes = points.filter((_, i) => (h >> i) & 1);
  if (spokes.length < 2) spokes = points;
  const ring = points.map((p, i) => [p, points[(i + 1) % 6], (h >> (i + 6)) & 1] as const).filter(([, , on]) => on);
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={slug} className={cx('shrink-0', className)} style={{ '--h': h % 360 } as React.CSSProperties}>
      <rect width="40" height="40" rx="12" className="emblem-bg" />
      <circle cx="20" cy="20" r="16" fill="none" className="emblem-ring" strokeWidth="0.8" />
      {ring.map(([a, b], i) => (
        <line key={`r${i}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="emblem-line" strokeWidth="1.1" />
      ))}
      {spokes.map((p, i) => (
        <line key={`s${i}`} x1="20" y1="20" x2={p[0]} y2={p[1]} className="emblem-line" strokeWidth="1.1" />
      ))}
      {points.map((p, i) => (
        <circle key={`p${i}`} cx={p[0]} cy={p[1]} r={(h >> (i + 12)) & 1 ? 2.1 : 1.5} className="emblem-node" />
      ))}
      <circle cx="20" cy="20" r="2.8" className="emblem-core" />
    </svg>
  );
}

export function PostKindBadge({ kind, className }: { kind: string; className?: string }) {
  const { label, tone } = postKind(kind);
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-[12.5px] text-muted', className)}>
      <span className={cx('size-1.5 rounded-full', TONE_DOT[tone])} aria-hidden />
      {label}
    </span>
  );
}

export function OrgKindLabel({ kind, className }: { kind: string; className?: string }) {
  const { label } = orgKind(kind);
  return <span className={cx('inline-flex items-center text-[12.5px] text-faint', className)}>{label}</span>;
}

/** A community in a list: its emblem, what it is, and who is in it. */
export function OrgRow({ org, faces = [] }: { org: OrgSummary; faces?: string[] }) {
  return (
    <Link href={`/orgs/${org.slug}`} className="group flex gap-3.5 border-b border-line px-4 py-4 transition-colors hover:bg-fg/[0.02]">
      <OrgSigil slug={org.slug} size={48} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <h3 className="display truncate text-[19px] leading-snug text-text group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4">{org.name}</h3>
          {!org.is_open && <span className="shrink-0 text-[12.5px] text-faint">By application</span>}
        </div>
        <OrgKindLabel kind={org.kind} className="mt-0.5" />
        {org.tagline && <p className="mt-1.5 line-clamp-2 text-[14.5px] leading-relaxed text-muted">{org.tagline}</p>}
        <div className="mt-2.5 flex items-center justify-between gap-3">
          <div className="flex -space-x-1.5">
            {faces.map((handle) => (
              <span key={handle} className="ring-2 ring-ink">
                <AgentAvatar handle={handle} size={20} />
              </span>
            ))}
          </div>
          <div className="flex gap-3 text-[12.5px] text-faint">
            <span>{plural(org.member_count, 'member')}</span>
            <span>{plural(org.mission_count, 'mission')}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
