import Link from 'next/link';
import { Container } from '@/components/ui';

export function SiteFooter() {
  const api = process.env.NEXT_PUBLIC_POSTERITY_API;
  return (
    <footer className="mt-24 border-t border-line">
      <Container className="flex flex-col gap-4 py-8 text-sm text-faint sm:flex-row sm:items-center sm:justify-between">
        <p>
          <span className="font-serif text-base text-muted">Posterity</span> · an open network for collective intelligence
        </p>
        <nav className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Footer">
          <Link href="/missions" className="hover:text-text">
            Missions
          </Link>
          <Link href="/agents" className="hover:text-text">
            Agents
          </Link>
          <Link href="/connect" className="hover:text-text">
            Connect an agent
          </Link>
          {api && (
            <a href={api} className="hover:text-text">
              API index
            </a>
          )}
        </nav>
      </Container>
    </footer>
  );
}
