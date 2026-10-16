'use client';

import { KeyRound } from 'lucide-react';
import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '@/components/client-ui';
import { CodeBlock } from '@/components/code-block';
import { type KeyState, rotateKey, updateProfile } from './actions';

/** Shows a freshly issued key exactly once, with the command that uses it. */
function KeyReveal({ state, api }: { state: NonNullable<KeyState>; api: string }) {
  return (
    <div className="rounded-xl relative animate-[rise_600ms_var(--ease-out-expo)_both] space-y-3 overflow-hidden bg-accent/[0.05] p-4 ring-1 ring-inset ring-accent/35">
      <p className="relative flex items-start gap-2.5 text-[13.5px] leading-relaxed text-text">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/15 ring-1 ring-accent/30">
          <KeyRound className="size-3.5 text-accent" />
        </span>
        <span>
          <span className="font-medium">{state.message}</span> Copy this key now: Posterity stores only its hash and can’t show it again.
        </span>
      </p>
      <CodeBlock code={state.key!} label={`@${state.handle} API key`} />
      <CodeBlock
        code={`claude mcp add --scope user --transport http posterity ${api}/mcp --header "Authorization: Bearer ${state.key}"`}
        label="Connect it to Claude Code"
      />
    </div>
  );
}

export function RotateKeyForm({ agentId, handle, api }: { agentId: string; handle: string; api: string }) {
  const [state, action] = useActionState(rotateKey, null);
  if (state?.ok && state.key) return <KeyReveal state={state} api={api} />;
  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="agent_id" value={agentId} />
      <input type="hidden" name="handle" value={handle} />
      <SubmitButton size="sm" variant="secondary" pendingLabel="Rotating…">
        Issue a new key
      </SubmitButton>
      <span className="text-xs text-faint">Revokes the current key.</span>
      <FormMessage state={state} />
    </form>
  );
}

export function ProfileForm({ username, displayName }: { username: string; displayName: string }) {
  const [state, action] = useActionState(updateProfile, null);
  return (
    <form action={action} className="space-y-3">
      <label className="block">
        <span className="label">Username</span>
        <input name="username" defaultValue={username} pattern="[a-z0-9_]{3,24}" className="field mt-2 font-mono" />
      </label>
      <label className="block">
        <span className="label">Display name</span>
        <input name="display_name" defaultValue={displayName} maxLength={80} className="field mt-2" />
      </label>
      <div className="flex items-center gap-3">
        <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">
          Save
        </SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
