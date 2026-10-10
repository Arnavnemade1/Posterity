'use client';

import { ChevronRight, ExternalLink, Webhook } from 'lucide-react';
import { useActionState } from 'react';
import { connectGitHub, disconnectGitHub, type GitHubState } from '@/app/actions';
import { FormMessage, SubmitButton } from '@/components/client-ui';
import { CodeBlock } from '@/components/code-block';

/** Shows the webhook settings once: Posterity cannot show the secret again. */
function WebhookReveal({ state, payloadUrl }: { state: NonNullable<GitHubState>; payloadUrl: string }) {
  return (
    <div className="relative animate-[rise_600ms_var(--ease-out-expo)_both] space-y-3 overflow-hidden rounded-[14px] bg-accent/[0.05] p-4 ring-1 ring-inset ring-accent/35">
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-accent/20 blur-3xl" />
      <p className="relative flex items-start gap-2.5 text-[13px] leading-relaxed text-text">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/15 ring-1 ring-accent/30">
          <Webhook className="size-3.5 text-accent" />
        </span>
        <span>
          <span className="font-medium">{state.message}</span> Add a webhook to the repository with these settings. Copy the secret now: it is shown only
          once.
        </span>
      </p>
      <CodeBlock code={payloadUrl} label="Payload URL" />
      <CodeBlock code={state.secret!} label="Secret" />
      <ul className="relative space-y-1 text-[12.5px] text-muted">
        <li>
          Content type: <span className="font-mono text-text">application/json</span>
        </li>
        <li>Events: pull requests, workflow runs, check suites and pushes</li>
      </ul>
      <a
        href={`https://github.com/${state.repo}/settings/hooks/new`}
        target="_blank"
        rel="noopener noreferrer"
        className="relative inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
      >
        Open the repository’s webhook settings <ExternalLink className="size-3.5" />
      </a>
    </div>
  );
}

/** Mission owners connect a repository, or rotate its secret and disconnect it. */
export function GitHubControls({
  missionId,
  repo,
  suggested,
  payloadUrl,
}: {
  missionId: string;
  repo: string | null;
  suggested: string | null;
  payloadUrl: string;
}) {
  const [state, action] = useActionState(connectGitHub, null);
  const [cut, disconnect] = useActionState(disconnectGitHub, null);
  if (state?.ok && state.secret) return <WebhookReveal state={state} payloadUrl={payloadUrl} />;

  if (!repo) {
    return (
      <form action={action} className="space-y-2.5">
        <input type="hidden" name="mission_id" value={missionId} />
        <input
          name="repo"
          required
          defaultValue={suggested ?? ''}
          className="field font-mono text-[13px]"
          placeholder="owner/name or the repository URL"
          aria-label="Repository"
        />
        <div className="flex items-center gap-3">
          <SubmitButton size="sm" pendingLabel="Connecting…">
            Connect repository
          </SubmitButton>
          <FormMessage state={state} />
        </div>
      </form>
    );
  }

  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] text-muted transition-colors hover:text-text [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 text-faint transition-transform group-open:rotate-90" /> Manage the connection
      </summary>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <form action={action}>
          <input type="hidden" name="mission_id" value={missionId} />
          <input type="hidden" name="repo" value={repo} />
          <SubmitButton size="sm" variant="secondary" pendingLabel="Issuing…">
            New webhook secret
          </SubmitButton>
        </form>
        <form action={disconnect}>
          <input type="hidden" name="mission_id" value={missionId} />
          <SubmitButton size="sm" variant="danger" pendingLabel="Disconnecting…">
            Disconnect
          </SubmitButton>
        </form>
      </div>
      <div className="mt-2 space-y-1">
        <FormMessage state={state} />
        <FormMessage state={cut} />
      </div>
    </details>
  );
}
