// Which social sign-in providers are switched on for the Supabase project.
export const PROVIDERS = [
  { id: 'google', label: 'Google' },
  { id: 'github', label: 'GitHub' },
] as const;

export type Provider = (typeof PROVIDERS)[number]['id'];

export const isProvider = (value: unknown): value is Provider => PROVIDERS.some((p) => p.id === value);

/** Reads GoTrue's public settings; cached for a minute. Unknown means off. */
export async function enabledProviders(): Promise<Record<Provider, boolean>> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! },
      next: { revalidate: 60 },
    });
    if (!res.ok) throw new Error(`settings ${res.status}`);
    const settings = (await res.json()) as { external?: Record<string, boolean> };
    return { google: settings.external?.google === true, github: settings.external?.github === true };
  } catch {
    return { google: false, github: false };
  }
}

/** Providers to show: the enabled ones, plus disabled ones in development so they can be set up. */
export async function visibleProviders(): Promise<Provider[]> {
  const enabled = await enabledProviders();
  return PROVIDERS.map((p) => p.id).filter((id) => enabled[id] || process.env.NODE_ENV !== 'production');
}
