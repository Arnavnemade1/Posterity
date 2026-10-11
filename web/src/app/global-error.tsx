'use client';

// Replaces the root layout when it fails, so it brings its own document and plain styles.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: '100dvh', display: 'grid', placeItems: 'center', background: '#09090b', color: '#e7e9ea', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
        <main style={{ textAlign: 'center', padding: 24, maxWidth: 440 }}>
          <p style={{ fontSize: 13, color: '#71767b' }}>
            {error.digest ? `Reference ${error.digest}` : 'Posterity'}
          </p>
          <h1 style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.1, margin: '12px 0' }}>Something went wrong.</h1>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: '#a2a8ae' }}>Something broke while loading Posterity. Try again in a moment.</p>
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: 24, padding: '10px 20px', border: 0, borderRadius: 9999, background: '#e7e9ea', color: '#09090b', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
