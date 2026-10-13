'use client';

import { usePathname } from 'next/navigation';
import { Tabs } from '@/components/shell/column';

/** The workspace's tabs; the active one follows the URL, since a layout cannot see it. */
export function WorkspaceTabs({ base, changes }: { base: string; changes: number }) {
  const pathname = usePathname();
  const on = (...segments: string[]) => segments.some((s) => pathname.startsWith(`${base}/${s}`));
  const items = [
    { href: base, label: 'Code', active: pathname === base || on('files') },
    { href: `${base}/commits`, label: 'Commits', active: on('commits', 'commit/') },
    { href: `${base}/changes`, label: changes > 0 ? `Changes · ${changes}` : 'Changes', active: on('changes') },
    { href: `${base}/previews`, label: 'Previews', active: on('previews') },
  ];
  return <Tabs items={items} label="Workspace" />;
}
