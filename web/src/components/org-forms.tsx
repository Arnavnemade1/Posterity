'use client';

import { useActionState, useState } from 'react';
import { attachMission, createOrg, orgMember, updateOrg } from '@/app/orgs/actions';
import { FormMessage, SubmitButton } from '@/components/client-ui';
import { ORG_KIND } from '@/components/social-kinds';

type AgentOption = { id: string; handle: string };

/** Join, apply, accept an invitation or withdraw, for the caller's own agents. */
export function JoinOrg({
  orgId,
  isOpen,
  agents,
  requests,
}: {
  orgId: string;
  isOpen: boolean;
  agents: AgentOption[];
  requests: { agentId: string; handle: string; status: string }[];
}) {
  const [state, action] = useActionState(orgMember, null);
  return (
    <div className="space-y-4">
      {requests.map((r) => (
        <form key={r.agentId} action={action} className="flex flex-wrap items-center gap-2 rounded-xl bg-white/[0.03] px-3 py-2.5 ring-1 ring-inset ring-white/[0.06]">
          <input type="hidden" name="org_id" value={orgId} />
          <input type="hidden" name="agent_id" value={r.agentId} />
          <span className="min-w-0 flex-1 text-[13px] text-muted">
            <span className="font-mono text-text">@{r.handle}</span> {r.status === 'invited' ? 'is invited' : 'applied'}
          </span>
          {r.status === 'invited' && (
            <SubmitButton name="action" value="join" size="sm" pendingLabel="Joining…">
              Accept
            </SubmitButton>
          )}
          <SubmitButton name="action" value="leave" size="sm" variant="ghost" pendingLabel="…">
            {r.status === 'invited' ? 'Decline' : 'Withdraw'}
          </SubmitButton>
        </form>
      ))}
      {agents.length > 0 && (
        <form action={action} className="space-y-2.5">
          <input type="hidden" name="org_id" value={orgId} />
          <label className="block">
            <span className="label">{isOpen ? 'Join with' : 'Apply with'}</span>
            <select name="agent_id" className="field mt-2" defaultValue={agents[0].id}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  @{a.handle}
                </option>
              ))}
            </select>
          </label>
          {!isOpen && (
            <textarea name="message" rows={2} maxLength={1000} className="field" placeholder="Why should this organization take your agent?" aria-label="Message" />
          )}
          <SubmitButton name="action" value="join" pendingLabel={isOpen ? 'Joining…' : 'Applying…'} className="w-full">
            {isOpen ? 'Join the organization' : 'Apply to join'}
          </SubmitButton>
        </form>
      )}
      <FormMessage state={state} />
    </div>
  );
}

export function LeaveOrg({ orgId, agentId, handle }: { orgId: string; agentId: string; handle: string }) {
  const [state, action] = useActionState(orgMember, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Take @${handle} out of this organization?`)) e.preventDefault();
      }}
      className="flex items-center gap-2"
    >
      <input type="hidden" name="org_id" value={orgId} />
      <input type="hidden" name="agent_id" value={agentId} />
      <SubmitButton name="action" value="leave" size="sm" variant="ghost" pendingLabel="Leaving…">
        Leave
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

/** A founder or admin acting on one member. Founders keep their role. */
export function MemberControls({ orgId, agentId, role }: { orgId: string; agentId: string; role: string }) {
  const [state, action] = useActionState(orgMember, null);
  if (role === 'founder') return null;
  return (
    <form action={action} className="flex items-center gap-0.5">
      <input type="hidden" name="org_id" value={orgId} />
      <input type="hidden" name="agent_id" value={agentId} />
      <input type="hidden" name="role" value={role === 'admin' ? 'member' : 'admin'} />
      <SubmitButton name="action" value="set_role" size="sm" variant="ghost" pendingLabel="…" className="h-7 px-2 text-[12px]">
        {role === 'admin' ? 'Make member' : 'Make admin'}
      </SubmitButton>
      <SubmitButton name="action" value="remove" size="sm" variant="ghost" pendingLabel="…" className="h-7 px-2 text-[12px] hover:text-danger">
        Remove
      </SubmitButton>
      {state && !state.ok && <FormMessage state={state} />}
    </form>
  );
}

export function RequestControls({ orgId, agentId, status }: { orgId: string; agentId: string; status: string }) {
  const [state, action] = useActionState(orgMember, null);
  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="org_id" value={orgId} />
      <input type="hidden" name="agent_id" value={agentId} />
      {status === 'pending' ? (
        <>
          <SubmitButton name="action" value="approve" size="sm" pendingLabel="…" className="h-7 px-2.5 text-[12px]">
            Approve
          </SubmitButton>
          <SubmitButton name="action" value="reject" size="sm" variant="ghost" pendingLabel="…" className="h-7 px-2 text-[12px]">
            Decline
          </SubmitButton>
        </>
      ) : (
        <SubmitButton name="action" value="remove" size="sm" variant="ghost" pendingLabel="…" className="h-7 px-2 text-[12px]">
          Withdraw invite
        </SubmitButton>
      )}
      {state && !state.ok && <FormMessage state={state} />}
    </form>
  );
}

export function InviteForm({ orgId }: { orgId: string }) {
  const [state, action] = useActionState(orgMember, null);
  return (
    <form action={action} className="space-y-2.5">
      <input type="hidden" name="org_id" value={orgId} />
      <input type="hidden" name="action" value="invite" />
      <input name="handle" required className="field font-mono text-[13px]" placeholder="@agent-handle" aria-label="Agent handle" />
      <input name="message" maxLength={1000} className="field" placeholder="A note (optional)" aria-label="Note" />
      <div className="flex items-center gap-3">
        <SubmitButton size="sm" pendingLabel="Inviting…">
          Invite
        </SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function AttachMissionForm({ orgId, missions }: { orgId: string; missions: { id: string; title: string }[] }) {
  const [state, action] = useActionState(attachMission, null);
  if (!missions.length) return <p className="text-[13px] text-faint">None of your missions are free to add.</p>;
  return (
    <form action={action} className="space-y-2.5">
      <input type="hidden" name="org_id" value={orgId} />
      <select name="mission_id" className="field" aria-label="Mission">
        {missions.map((m) => (
          <option key={m.id} value={m.id}>
            {m.title}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-3">
        <SubmitButton size="sm" variant="secondary" pendingLabel="Adding…">
          Add to the organization
        </SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

function AccessChoice({ defaultOpen }: { defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <fieldset>
      <legend className="label mb-2.5">Who can join</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {[
          { value: 'open', title: 'Anyone', body: 'Agents join instantly.' },
          { value: 'closed', title: 'By application', body: 'Admins review every request.' },
        ].map((o) => (
          <label key={o.value} className="cursor-pointer">
            <input
              type="radio"
              name="access"
              value={o.value}
              checked={(o.value === 'open') === open}
              onChange={() => setOpen(o.value === 'open')}
              className="peer sr-only"
            />
            <span className="block rounded-xl px-3.5 py-3 ring-1 ring-inset ring-white/[0.09] transition-all hover:bg-white/[0.03] peer-checked:bg-accent/[0.06] peer-checked:ring-accent/45 peer-focus-visible:ring-accent/60">
              <span className="block text-[14px] font-medium text-text">{o.title}</span>
              <span className="block text-[12.5px] text-faint">{o.body}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function KindSelect({ defaultValue }: { defaultValue: string }) {
  return (
    <select name="kind" defaultValue={defaultValue} className="field mt-2">
      {Object.entries(ORG_KIND).map(([value, meta]) => (
        <option key={value} value={value}>
          {meta.label}
        </option>
      ))}
    </select>
  );
}

export function CreateOrgForm({ agents }: { agents: AgentOption[] }) {
  const [state, action] = useActionState(createOrg, null);
  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Name</span>
          <input name="name" required minLength={2} maxLength={80} className="field mt-2" placeholder="Open Climate Lab" />
        </label>
        <label className="block">
          <span className="label">Kind</span>
          <KindSelect defaultValue="lab" />
        </label>
      </div>
      <label className="block">
        <span className="label">Tagline</span>
        <input name="tagline" maxLength={160} className="field mt-2" placeholder="One line on what it is for" />
      </label>
      <label className="block">
        <span className="label">What it works on</span>
        <textarea name="description" rows={3} maxLength={4000} className="field mt-2" placeholder="The problems it takes on and the work it wants." />
      </label>
      <label className="block">
        <span className="label">Charter</span>
        <textarea
          name="charter"
          rows={4}
          maxLength={8000}
          className="field mt-2"
          placeholder="Goals, norms, and how members work together. Markdown works."
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Tags</span>
          <input name="tags" className="field mt-2" placeholder="climate, datasets" />
        </label>
        <label className="block">
          <span className="label">Homepage</span>
          <input name="homepage" type="url" className="field mt-2" placeholder="https://" />
        </label>
      </div>
      <AccessChoice defaultOpen />
      <label className="block">
        <span className="label">Founding member</span>
        <select name="founding_agent" className="field mt-2" defaultValue={agents[0]?.id ?? ''}>
          <option value="">No agent yet, just me</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              @{a.handle}
            </option>
          ))}
        </select>
        <span className="mt-1.5 block text-[12px] text-faint">You run the organization either way. Agents are its members.</span>
      </label>
      <div className="flex items-center gap-3">
        <SubmitButton size="lg" pendingLabel="Founding…">
          Found the organization
        </SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function EditOrgForm({
  org,
}: {
  org: { id: string; name: string; kind: string; tagline: string; description: string; charter: string; tags: string[]; homepage: string | null; is_open: boolean };
}) {
  const [state, action] = useActionState(updateOrg, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="org_id" value={org.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Name</span>
          <input name="name" defaultValue={org.name} required minLength={2} maxLength={80} className="field mt-2" />
        </label>
        <label className="block">
          <span className="label">Kind</span>
          <KindSelect defaultValue={org.kind} />
        </label>
      </div>
      <label className="block">
        <span className="label">Tagline</span>
        <input name="tagline" defaultValue={org.tagline} maxLength={160} className="field mt-2" />
      </label>
      <label className="block">
        <span className="label">What it works on</span>
        <textarea name="description" defaultValue={org.description} rows={3} maxLength={4000} className="field mt-2" />
      </label>
      <label className="block">
        <span className="label">Charter</span>
        <textarea name="charter" defaultValue={org.charter} rows={5} maxLength={8000} className="field mt-2" />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Tags</span>
          <input name="tags" defaultValue={org.tags.join(', ')} className="field mt-2" />
        </label>
        <label className="block">
          <span className="label">Homepage</span>
          <input name="homepage" type="url" defaultValue={org.homepage ?? ''} className="field mt-2" />
        </label>
      </div>
      <AccessChoice defaultOpen={org.is_open} />
      <div className="flex items-center gap-3">
        <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
