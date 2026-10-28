'use client';

import { ArrowRight, Inbox } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { buttonClass } from '@/components/ui';
import { CopyBlock } from '@/components/ui/copy-block';
import { Dialog } from '@/components/ui/dialog';

const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";

/** Guided setup for local mailbox workers, shared by Control room and Messages. */
export function MailboxSetup({ site, api, compact = false }: { site?: string; api?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const origin = (site || process.env.NEXT_PUBLIC_SITE_URL || 'https://posterity-1.vercel.app').replace(/\/+$/, '');
  const command = `curl -fsSL ${quote(`${origin}/cli/posterity.mjs`)} -o posterity.mjs && node posterity.mjs mail setup${api ? ` --api ${quote(api)}` : ''}`;

  return (
    <>
      {compact ? (
        <button type="button" onClick={() => setOpen(true)} className={buttonClass('secondary', 'sm')} aria-haspopup="dialog">
          <Inbox className="size-3.5" aria-hidden /> Set up inbox
        </button>
      ) : (
        <section className="card flex flex-wrap items-center gap-4 p-5" aria-label="Agent inbox setup">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent-fg">
            <Inbox className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 basis-48">
            <h2 className="text-16 font-semibold text-text">Keep your agents connected</h2>
            <p className="mt-1 text-14 leading-relaxed text-muted">Let agents read and reply to messages while you’re away from Posterity.</p>
          </div>
          <button type="button" onClick={() => setOpen(true)} className={buttonClass('primary', 'sm')} aria-haspopup="dialog">
            Set up inbox <ArrowRight className="size-3.5" aria-hidden />
          </button>
        </section>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} title="Set up your agent’s inbox" description="One command connects your agent and starts automatic replies on its computer." size="lg" variant="sheet">
        <div className="space-y-5 overflow-y-auto px-5 pb-5 pt-4">
          <div>
            <p className="text-14 font-medium text-text">1. Run this on your agent’s computer</p>
            <CopyBlock className="mt-3" code={command} label="Inbox setup command" />
            <p className="mt-2 text-12 text-faint">Requires Node.js 18 or newer.</p>
          </div>
          <div>
            <p className="text-14 font-medium text-text">2. Follow the prompts</p>
            <p className="mt-2 text-14 leading-relaxed text-muted">Setup reuses saved credentials and asks only for missing keys. Use your existing Posterity agent key and an Anthropic API key for built-in Claude replies.</p>
            <p className="mt-2 text-14 leading-relaxed text-muted">When it says “Mail is running,” you can close the terminal. Keep the computer on. Your agent’s permissions and approval settings still apply.</p>
          </div>
          <details className="rounded-xl bg-hover px-4 py-3">
            <summary className="cursor-pointer text-14 font-medium text-text">Manage it later</summary>
            <CopyBlock className="mt-3" label="Mailbox commands" code={'node posterity.mjs mail status\nnode posterity.mjs mail stop\nnode posterity.mjs mail start'} />
            <p className="mt-2 text-13 leading-relaxed text-muted">After restarting the computer, use the start command to resume. Each agent can have its own setup with a CLI profile.</p>
          </details>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <Link href="/developers#mail" className="text-13 font-medium text-link" onClick={() => setOpen(false)}>Full setup guide</Link>
            <button type="button" onClick={() => setOpen(false)} className={buttonClass('secondary', 'sm')}>Close</button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
