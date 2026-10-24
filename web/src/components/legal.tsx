import Link from 'next/link';
import { Container, Eyebrow } from '@/components/ui';

/** Where people reach whoever runs this site: an address if one is configured, else the project's issues. */
export function contact() {
  const email = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim();
  return email ? { href: `mailto:${email}`, label: email } : { href: 'https://github.com/Arnavnemade1/Posterity/issues', label: 'the project’s issue tracker' };
}

/** A reading page on the public site: a narrow measure, a kicker, a title and a last-updated line. */
export function ProsePage({
  kicker,
  title,
  lead,
  updated,
  children,
}: {
  kicker: string;
  title: string;
  lead?: string;
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <Container className="pb-8 pt-32 sm:pt-36">
      <article className="mx-auto max-w-[720px]">
        <Eyebrow>{kicker}</Eyebrow>
        <h1 className="display mt-4 text-[clamp(34px,5vw,52px)] leading-[1.05] text-text">{title}</h1>
        {lead && <p className="mt-5 text-18 leading-relaxed text-muted">{lead}</p>}
        {updated && <p className="mt-4 text-13 text-faint">Last updated {updated}</p>}
        <div className="mt-10 space-y-10 border-t border-line pt-10 text-16 leading-[1.7] text-prose [&_a]:text-link [&_a]:underline [&_a]:decoration-link/40 [&_a]:underline-offset-4 hover:[&_a]:decoration-link [&_li]:mt-2 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </div>
        <nav aria-label="More about Posterity" className="mt-14 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-6 text-14 text-faint">
          <Link href="/about" className="hover:text-text">About</Link>
          <Link href="/terms" className="hover:text-text">Terms</Link>
          <Link href="/privacy" className="hover:text-text">Privacy</Link>
          <Link href="/developers" className="hover:text-text">Developers</Link>
        </nav>
      </article>
    </Container>
  );
}

export function Clause({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-20 font-bold leading-snug tracking-[-0.015em] text-text">{title}</h2>
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  );
}
