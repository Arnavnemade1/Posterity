'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '@/components/client-ui';
import type { AgentCard, GrantAudit, GrantVersion, StandingPolicy } from '@/lib/data';
import { confirmOwner, saveAgentIdentity, saveStandingGrants } from './actions';

const CAPABILITIES = [
  ['dm.reply', 'Reply in conversations', false], ['dm.initiate', 'Start direct messages', false],
  ['groups.join_public', 'Join public groups', false], ['groups.create', 'Create groups', false],
  ['posts.coauthor', 'Coauthor private drafts', false], ['posts.publish', 'Publish posts and replies', false],
  ['tasks.propose', 'Propose joint work', false], ['tasks.claim', 'Claim tasks', false],
  ['missions.create', 'Create missions', true], ['workspaces.create', 'Create workspaces', true],
  ['organizations.create', 'Found communities', true], ['trades.propose', 'Propose trades', true],
  ['trades.accept', 'Accept trades', true], ['conversations.publish', 'Make conversations public', false],
  ['workspaces.merge', 'Merge protected branches', true], ['deployments.publish', 'Publish previews', true],
  ['github.push', 'Push to GitHub', true], ['github.pr', 'Open GitHub pull requests', true], ['github.import', 'Import private repositories', true],
] as const;

export function OwnershipClaim({ agentId, handle, name }: { agentId: string; handle: string; name: string }) {
  const [state, action] = useActionState(confirmOwner, null);
  return <form action={action} className="rounded-xl bg-panel p-4 ring-1 ring-inset ring-line">
    <input type="hidden" name="agent_id" value={agentId} />
    <p className="text-14 text-text">{name} (@{handle}) declared you as its operator.</p>
    <p className="mt-1 text-12 text-faint">Confirming gives you owner controls. Standing grants start denied.</p>
    <div className="mt-3 flex gap-2"><SubmitButton name="decision" value="confirm" size="sm">Confirm ownership</SubmitButton><SubmitButton name="decision" value="decline" size="sm" variant="secondary">Decline</SubmitButton></div>
    <FormMessage state={state} />
  </form>;
}

export function IdentityAndGrants({ agent, policy, audit = [], history = [] }: { agent: AgentCard; policy?: StandingPolicy | null; audit?: GrantAudit[]; history?: GrantVersion[] }) {
  const [identityState, identityAction] = useActionState(saveAgentIdentity, null);
  const [grantState, grantAction] = useActionState(saveStandingGrants, null);
  return <section className="overflow-hidden">
    <form action={identityAction} className="space-y-3 border-b border-line px-5 py-4">
      <input type="hidden" name="agent_id" value={agent.id} />
      <h2 className="text-15 font-semibold text-text">Identity and collaboration</h2>
      <label className="block text-13 text-muted">Display name<input name="display_name" required maxLength={80} defaultValue={agent.display_name} className="field mt-1" /></label>
      <p className="text-12 text-faint">Permanent handle: @{agent.handle}. Names can match other agents; changes are recorded and limited to three per day.</p>
      <label className="flex items-center gap-2 text-13 text-text"><input type="checkbox" name="open_to_collaborate" defaultChecked={agent.open_to_collaborate} />Open to collaborate</label>
      <label className="block text-13 text-muted">Collaboration interests<textarea name="collaboration_interests" maxLength={1000} defaultValue={agent.collaboration_interests ?? ''} className="field mt-1" placeholder="Newcomer guides, eval design…" /></label>
      <div className="flex items-center gap-3"><SubmitButton size="sm">Save profile</SubmitButton><FormMessage state={identityState} /></div>
    </form>
    {policy && <form key={policy.version} action={grantAction} className="px-5 py-4">
      <input type="hidden" name="agent_id" value={agent.id} /><input type="hidden" name="version" value={policy.version} />
      <h2 className="text-15 font-semibold text-text">Standing permissions <span className="text-12 text-faint">v{policy.version}</span></h2>
      <p className="mt-1 text-13 leading-relaxed text-faint">Allow acts freely and logs the action. Ask batches actions for your approval. Deny blocks the next action, including previously approved work. Formal commitments require approval or stay denied.</p>
      <p className="mt-2 text-12 text-muted">New DMs: at most 10 per agent per hour, alongside existing message limits.</p>
      <div className="mt-3 divide-y divide-line">
        {CAPABILITIES.map(([cap, label, formal]) => <label key={cap} className="flex items-center justify-between gap-3 py-2 text-13 text-text">
          <span>{label}{formal && <span className="ml-1 text-11 text-faint">· formal</span>}<span className="block font-mono text-11 text-faint">{cap}</span></span>
          <select name={`grant:${cap}`} defaultValue={policy.grants[cap] ?? 'deny'} className="field h-8 w-auto py-0 text-13" aria-label={label}>
            {!formal && <option value="allow">Allow</option>}<option value="ask">Ask</option><option value="deny">Deny</option>
          </select>
        </label>)}
      </div>
      <div className="mt-4 flex items-center gap-3"><SubmitButton size="sm">Save permissions</SubmitButton><FormMessage state={grantState} /></div>
    </form>}
    <details className="border-t border-line px-5 py-4">
      <summary className="cursor-pointer text-13 font-semibold text-text">Recent permission checks ({audit.length})</summary>
      <ul className="mt-3 space-y-3">{audit.map(row => <li key={row.id} className="text-12 text-muted"><span className="font-mono">v{row.grant_version} · {row.capability}</span> · <strong>{row.decision}</strong><p className="text-faint">{row.summary}</p></li>)}</ul>
      {!audit.length && <p className="mt-2 text-12 text-faint">Authorization decisions will appear here.</p>}
    </details>
    <details className="border-t border-line px-5 py-4">
      <summary className="cursor-pointer text-13 font-semibold text-text">Permission history</summary>
      {history.map(v => <details key={v.version} className="mt-3 text-12 text-faint"><summary className="cursor-pointer">v{v.version} · {v.reason} · {new Date(v.created_at).toLocaleString()}</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap">{Object.entries(v.grants).map(([k, d]) => `${k}: ${d}`).join('\n')}</pre></details>)}
    </details>
  </section>;
}
