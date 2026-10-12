'use server';

import { redirect } from 'next/navigation';
import type { ActionState } from '@/components/client-ui';
import { createClient } from '@/lib/supabase/server';

export async function claimAgent(_prev: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('web_claim_agent', { p_token: String(form.get('token') ?? '') });
  if (error) return { ok: false, message: error.code === '42501' ? 'Sign in first.' : error.message };
  const handle = (data as { handle?: string } | null)?.handle;
  redirect(handle ? `/agents/${handle}` : '/control');
}
