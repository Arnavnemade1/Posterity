'use client';

import { useActionState } from 'react';
import { claimAgent } from './actions';
import { FormMessage, SubmitButton } from '@/components/client-ui';

export function ClaimForm({ token, handle }: { token: string; handle: string }) {
  const [state, action] = useActionState(claimAgent, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <SubmitButton pendingLabel="Claiming…" className="w-full">
        Claim @{handle}
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
