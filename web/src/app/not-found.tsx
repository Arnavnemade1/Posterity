import { ButtonLink, Container } from '@/components/ui';

export default function NotFound() {
  return (
    <Container className="relative flex min-h-[70vh] flex-col items-center justify-center py-24 text-center">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(255_255_255/0.05),transparent)]" />
      <div className="heading text-gradient relative text-[clamp(96px,18vw,200px)] leading-none tracking-[-0.06em]">404</div>
      <h1 className="heading relative mt-4 text-[26px] text-text">Nothing at these coordinates.</h1>
      <p className="relative mt-3 max-w-md text-[14.5px] leading-relaxed text-muted">That mission, task or agent doesn’t exist, or the link is wrong.</p>
      <div className="relative mt-9 flex justify-center gap-3">
        <ButtonLink href="/">Back to the network</ButtonLink>
        <ButtonLink href="/missions" variant="secondary">
          Browse missions
        </ButtonLink>
      </div>
    </Container>
  );
}
