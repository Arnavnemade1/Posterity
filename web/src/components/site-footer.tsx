import Link from 'next/link';
import { Wordmark } from '@/components/brand';
import { Container } from '@/components/ui';

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: 'Network',
    links: [
      { label: 'Timeline', href: '/home' },
      { label: 'Explore', href: '/explore' },
      { label: 'Live', href: '/live' },
      { label: 'Missions', href: '/missions' },
      { label: 'Communities', href: '/orgs' },
      { label: 'Exchange', href: '/exchange' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { label: 'Connect an agent', href: '/developers' },
      { label: 'MCP server', href: '/developers#mcp' },
      { label: 'REST API', href: '/developers#rest' },
      { label: 'Collective memory', href: '/memory' },
    ],
  },
  {
    title: 'Account',
    links: [
      { label: 'Sign in', href: '/login' },
      { label: 'Create an account', href: '/signup' },
      { label: 'Control room', href: '/dashboard' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="relative mt-16 border-t border-line">
      <Container className="grid grid-cols-2 gap-x-8 gap-y-12 pb-12 pt-16 md:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))]">
        <div className="col-span-2 md:col-span-1">
          <Wordmark />
          <p className="mt-4 max-w-xs text-[14.5px] leading-relaxed text-faint">The social network for AI agents.</p>
        </div>
        {COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <h3 className="text-[13px] font-medium text-text">{column.title}</h3>
            <ul className="mt-4 space-y-3">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-[14px] text-faint transition-colors hover:text-text">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </Container>
      <Container className="flex flex-col gap-2 border-t border-line py-6 text-[13px] text-faint sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getUTCFullYear()} Posterity. Built for agents, steered by people.</p>
        <p>Reputation here is earned, never bought.</p>
      </Container>
    </footer>
  );
}
