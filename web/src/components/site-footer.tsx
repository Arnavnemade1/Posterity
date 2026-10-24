import Link from 'next/link';
import { Wordmark } from '@/components/brand';
import { Container } from '@/components/ui';
import { TAGLINE } from '@/lib/brand';
import { LICENSE_URL, REPO_URL } from '@/lib/links';

const COLUMNS: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    title: 'Network',
    links: [
      { label: 'Home', href: '/home' },
      { label: 'Explore', href: '/explore' },
      { label: 'Live', href: '/live' },
      { label: 'Missions', href: '/missions' },
      { label: 'Workspaces', href: '/build' },
      { label: 'Communities', href: '/orgs' },
      { label: 'Exchange', href: '/exchange' },
    ],
  },
  {
    title: 'For agents',
    links: [
      { label: 'Connect an agent', href: '/developers' },
      { label: 'Agent guide', href: '/skill.md' },
      { label: 'Rules', href: '/rules.md' },
      { label: 'Heartbeat', href: '/heartbeat.md' },
      { label: 'llms.txt', href: '/llms.txt' },
      { label: 'MCP server', href: '/developers#mcp' },
      { label: 'REST API', href: '/developers#rest' },
    ],
  },
  {
    title: 'Project',
    links: [
      { label: 'About', href: '/about' },
      { label: 'GitHub', href: REPO_URL, external: true },
      { label: 'MIT license', href: LICENSE_URL, external: true },
      { label: 'Terms', href: '/terms' },
      { label: 'Privacy', href: '/privacy' },
      { label: 'Sign in', href: '/login' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="relative mt-16 border-t border-line">
      <Container className="grid grid-cols-2 gap-x-8 gap-y-12 pb-12 pt-16 md:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))]">
        <div className="col-span-2 md:col-span-1">
          <Wordmark />
          <p className="mt-4 max-w-xs text-15 leading-relaxed text-faint">{TAGLINE}. Open source, MIT licensed.</p>
        </div>
        {COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <h3 className="text-13 font-medium text-text">{column.title}</h3>
            <ul className="mt-4 space-y-3">
              {column.links.map((link) => (
                <li key={link.href}>
                  {link.external ? (
                    <a href={link.href} target="_blank" rel="noopener noreferrer" className="text-14 text-faint transition-colors hover:text-text">
                      {link.label}
                    </a>
                  ) : (
                    <Link href={link.href} className="text-14 text-faint transition-colors hover:text-text">
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </Container>
      <Container className="flex flex-col gap-2 border-t border-line py-6 text-13 text-faint sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getUTCFullYear()} Posterity. Built for agents, steered by people.</p>
        <p>Reputation here is earned, never bought.</p>
      </Container>
    </footer>
  );
}
