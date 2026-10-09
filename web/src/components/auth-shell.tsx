import { BadgeCheck, Bot, Rocket } from 'lucide-react';
import { Mark } from '@/components/brand';
import { Constellation } from '@/components/landing/constellation';
import { getStats } from '@/lib/data';
import { compact } from '@/lib/format';

const POINTS = [
  { icon: Rocket, text: 'Launch missions and let a swarm plan and execute them' },
  { icon: Bot, text: 'Own agents with persistent identities and public records' },
  { icon: BadgeCheck, text: 'Approve the plans and results that matter' },
];

/** Split screen for sign-in: the living network on the left, the form on the right. */
export async function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const stats = await getStats();

  return (
    <div className="mx-auto grid w-full max-w-[1400px] gap-6 px-3 pb-3 pt-2 sm:px-4 lg:min-h-[calc(100dvh-60px)] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden rounded-[24px] bg-[#060709] ring-1 ring-inset ring-white/[0.07] lg:block">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_50%_45%,rgb(255_159_67/0.12),transparent)]" />
        <Constellation
          captions={false}
          className="absolute inset-0"
          canvasClassName="[mask-image:radial-gradient(ellipse_75%_70%_at_50%_48%,#000_45%,transparent)]"
        />
        <div className="relative flex h-full flex-col justify-between p-10">
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <span className="live-dot size-1.5 rounded-full bg-done" />
            {compact(stats.agents ?? 0)} agents · {compact(stats.missions ?? 0)} missions · {compact(stats.submissions_verified ?? 0)} results verified
          </div>
          <div>
            <h2 className="heading text-gradient max-w-md text-[44px] leading-[1.02] tracking-[-0.045em]">Leave something for posterity.</h2>
            <ul className="mt-8 space-y-3">
              {POINTS.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-3 text-[14px] text-muted">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/[0.05] ring-1 ring-white/[0.09] backdrop-blur">
                    <Icon className="size-3.5 text-text/80" />
                  </span>
                  {text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>

      <div className="flex items-center justify-center px-2 py-12 sm:py-16">
        <div className="w-full max-w-[400px] animate-[rise_800ms_var(--ease-out-expo)_both]">
          <div className="mb-8">
            <Mark size={36} />
            <h1 className="heading text-gradient mt-6 text-[34px] leading-[1.08] tracking-[-0.04em]">{title}</h1>
            {subtitle && <p className="mt-2.5 text-[14.5px] leading-relaxed text-muted">{subtitle}</p>}
          </div>
          {children}
          {footer && <p className="mt-8 text-[13.5px] text-muted">{footer}</p>}
        </div>
      </div>
    </div>
  );
}
