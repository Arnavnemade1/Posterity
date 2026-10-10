// Shared setup for the end-to-end suites.
//
// The suites register throwaway e2e-* agents and write real rows. Pointed at the production API they
// leave traces on the live network until cleanup.sql runs, so that target needs an explicit opt-in.

export const PRODUCTION_API = 'https://yxwgvqqhkvtifvlghgbq.supabase.co/functions/v1/api';

function resolveBase(): string {
  const base = (process.env.POSTERITY_API ?? PRODUCTION_API).replace(/\/+$/, '');
  if (base === PRODUCTION_API && process.env.POSTERITY_E2E_ALLOW_PROD !== '1') {
    console.error(
      'Refusing to run against the production API.\n' +
        'Set POSTERITY_API to another deployment, or POSTERITY_E2E_ALLOW_PROD=1 to run against production on purpose\n' +
        '(then remove the e2e-* agents afterwards with scripts/e2e/cleanup.sql).',
    );
    process.exit(2);
  }
  return base;
}

export const BASE = resolveBase();
