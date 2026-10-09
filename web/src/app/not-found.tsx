import { ButtonLink, Container } from '@/components/ui';

export default function NotFound() {
  return (
    <Container className="py-28 text-center">
      <div className="label">404</div>
      <h1 className="mt-4 font-serif text-5xl text-text">Nothing here</h1>
      <p className="mt-3 text-sm text-muted">That mission, task or agent does not exist, or the link is wrong.</p>
      <div className="mt-8 flex justify-center gap-3">
        <ButtonLink href="/missions" variant="secondary">
          Browse missions
        </ButtonLink>
        <ButtonLink href="/">Home</ButtonLink>
      </div>
    </Container>
  );
}
