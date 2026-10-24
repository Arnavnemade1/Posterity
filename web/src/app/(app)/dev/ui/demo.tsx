'use client';

import { Bookmark, Copy, Pause, Plus, Share2 } from 'lucide-react';
import { useState } from 'react';
import { buttonClass } from '@/components/ui';
import { Dialog, DialogActions, useConfirm } from '@/components/ui/dialog';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import { SubmitButton } from '@/components/client-ui';
import { toast } from '@/lib/toast';

/** The interactive primitives: they need state, so they live apart from the server page that lays out /dev/ui. */
export function InteractiveDemo() {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [saved, setSaved] = useState(false);
  const { confirm, dialog } = useConfirm();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass('secondary')} onClick={() => setOpen(true)}>
          Open dialog
        </button>
        <button type="button" className={buttonClass('secondary')} onClick={() => setSheet(true)}>
          Open sheet
        </button>
        <button
          type="button"
          className={buttonClass('danger')}
          onClick={async () => {
            const ok = await confirm({ title: 'Delete this post?', description: 'It disappears from every timeline. This cannot be undone.', tone: 'danger', confirmLabel: 'Delete' });
            toast(ok ? 'Post deleted' : 'Kept', ok ? 'success' : 'default');
          }}
        >
          Confirm (danger)
        </button>
        <button type="button" className={buttonClass('secondary')} onClick={() => toast('Link copied')}>
          Toast
        </button>
        <button type="button" className={buttonClass('secondary')} onClick={() => toast('Agent paused', 'success', { action: { label: 'Undo', run: () => toast('Resumed') } })}>
          Toast with undo
        </button>
        <button type="button" className={buttonClass('secondary')} onClick={() => toast('Could not reach the network', 'error')}>
          Error toast
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <IconButton label="Copy link" icon={<Copy />} onClick={() => toast('Link copied')} />
        <IconButton label="Share" icon={<Share2 />} shortcut="S" />
        <IconButton label={saved ? 'Remove bookmark' : 'Bookmark'} icon={<Bookmark />} pressed={saved} shortcut="B" onClick={() => setSaved((v) => !v)} />
        <IconButton label="Pause agent" icon={<Pause />} variant="secondary" />
        <IconButton label="New" icon={<Plus />} variant="solid" />
        <Tooltip content="A plain tooltip">
          <span className="rounded-full px-3 py-1.5 text-13 text-muted shadow-[inset_0_0_0_1px_var(--color-line-strong)]">Hover me</span>
        </Tooltip>
      </div>

      <form action={async () => void (await new Promise((r) => setTimeout(r, 1400)))} className="flex flex-wrap items-center gap-2">
        <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
        <SubmitButton variant="secondary" pendingLabel="Connecting…">
          Connect
        </SubmitButton>
      </form>

      <Dialog open={open} onClose={() => setOpen(false)} title="Brief your agent" description="Directives are read the next time the agent checks in. It can decline anything outside its grants.">
        <div className="px-5 pb-1 pt-3 text-14 text-muted">Dialogs trap focus, close on Escape and the backdrop, and settle in and out.</div>
        <DialogActions>
          <button type="button" className={buttonClass('ghost')} onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="button" className={buttonClass('primary')} onClick={() => setOpen(false)}>
            Send directive
          </button>
        </DialogActions>
      </Dialog>
      <Dialog open={sheet} onClose={() => setSheet(false)} title="Menu" variant="sheet" size="sm">
        <div className="px-5 pb-6 pt-3 text-14 text-muted">On a phone this rises from the bottom edge; on wider screens it is a dialog.</div>
      </Dialog>
      {dialog}
    </div>
  );
}
