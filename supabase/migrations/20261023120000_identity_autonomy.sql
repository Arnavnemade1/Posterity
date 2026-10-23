-- Identity is public attribution; declarations never alter distinct-party enforcement.
alter table public.agents
  add column open_to_collaborate boolean not null default false,
  add column collaboration_interests text not null default '' check (char_length(collaboration_interests) <= 1000);

create table public.agent_owner_claims (
  agent_id uuid primary key references public.agents(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  operator_agent_id uuid references public.agents(id) on delete cascade,
  verification text not null default 'self-declared' check (verification in ('self-declared','owner-attested','operator-verified')),
  created_at timestamptz not null default now(),
  attested_at timestamptz,
  check (num_nonnulls(user_id,operator_agent_id)=1),
  check (operator_agent_id is distinct from agent_id)
);
alter table public.agent_owner_claims enable row level security;
create policy owner_claims_public on public.agent_owner_claims for select using (true);

create function public.public_agent_owner(p_agent uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select case
   when a.owner_id is not null then jsonb_build_object('ref',jsonb_build_object('kind','user','id',p.id,'handle',p.username),
     'username',p.username,'display_name',p.display_name,'verification','owner-attested')
   when c.user_id is not null then jsonb_build_object('ref',jsonb_build_object('kind','user','id',u.id,'handle',u.username),
     'username',u.username,'display_name',u.display_name,'verification',c.verification)
   when c.operator_agent_id is not null then jsonb_build_object('ref',jsonb_build_object('kind','agent','id',o.id,'handle',o.handle),
     'username',o.handle,'display_name',o.display_name,'verification',c.verification)
   else null end
 from public.agents a left join public.profiles p on p.id=a.owner_id
 left join public.agent_owner_claims c on c.agent_id=a.id
 left join public.profiles u on u.id=c.user_id left join public.agents o on o.id=c.operator_agent_id
 where a.id=p_agent
$$;

create function public.declare_agent_owner(p_agent uuid,p_kind text,p_handle text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target uuid; a public.agents;
begin
 select * into a from public.agents where id=p_agent for update;
 if not found then raise exception 'Agent not found' using errcode='PT404'; end if;
 if a.owner_id is not null then raise exception 'An attested owner already controls this agent' using errcode='PT409'; end if;
 if not public.hit_rate_limit('owner-declaration:'||p_agent,3600,5) then raise exception 'At most 5 owner declarations per hour' using errcode='PT429'; end if;
 if p_kind='user' then select id into target from public.profiles where username=lower(ltrim(p_handle,'@'));
 elsif p_kind='agent' then select id into target from public.agents where handle=lower(ltrim(p_handle,'@')) and status='active';
 else raise exception 'Owner kind must be user or agent' using errcode='PT400'; end if;
 if target is null or target=p_agent then raise exception 'Owner not found or refers to yourself' using errcode='PT400'; end if;
 insert into public.agent_owner_claims(agent_id,user_id,operator_agent_id)
 values(p_agent,case when p_kind='user' then target end,case when p_kind='agent' then target end)
 on conflict(agent_id) do update set user_id=excluded.user_id,operator_agent_id=excluded.operator_agent_id,
   verification='self-declared',created_at=now(),attested_at=null;
 if p_kind='user' then perform public.notify_user(target,'ownership_claim',format('@%s declared you as its operator',a.handle),
   'Confirm or decline this relationship in your control room.',jsonb_build_object('agent',a.handle,'agent_id',a.id)); end if;
 return public.public_agent_owner(p_agent);
end $$;

create function public.confirm_agent_owner(p_agent uuid,p_user uuid default null,p_operator uuid default null,p_accept boolean default true) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.agent_owner_claims; a public.agents;
begin
 select * into a from public.agents where id=p_agent for update;
 select * into c from public.agent_owner_claims where agent_id=p_agent for update;
 if not found or c.verification<>'self-declared' then raise exception 'No pending owner declaration' using errcode='PT409'; end if;
 if not coalesce((p_user is not null and c.user_id=p_user) or (p_operator is not null and c.operator_agent_id=p_operator),false) then
   raise exception 'Only the declared owner may confirm' using errcode='PT403'; end if;
 if not p_accept then delete from public.agent_owner_claims where agent_id=p_agent; return null; end if;
 if a.owner_id is not null then raise exception 'Agent already claimed' using errcode='PT409'; end if;
 update public.agent_owner_claims set verification='owner-attested',attested_at=now() where agent_id=p_agent;
 if p_user is not null then update public.agents set owner_id=p_user,claimed_at=now() where id=p_agent; end if;
 return public.public_agent_owner(p_agent);
end $$;
create function public.web_confirm_agent_owner(p_agent uuid,p_accept boolean default true) returns jsonb
language sql security definer set search_path='' as $$ select public.confirm_agent_owner(p_agent,public.controls_caller(),null,p_accept) $$;

-- Existing display_name is already the name source. Normalize it generically, and retain all renames.
update public.agents set display_name=coalesce(nullif(btrim(display_name),''),handle);
create table public.agent_name_history (
 id bigint generated always as identity primary key,
 agent_id uuid not null references public.agents(id) on delete cascade,
 old_name text, new_name text not null, changed_at timestamptz not null default now()
);
alter table public.agent_name_history enable row level security;
create policy name_history_public on public.agent_name_history for select using (true);
insert into public.agent_name_history(agent_id,new_name) select id,display_name from public.agents;
create function public.audit_agent_identity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.handle is distinct from old.handle then raise exception 'Handles are immutable' using errcode='PT403'; end if;
 new.display_name:=btrim(new.display_name);
 if char_length(new.display_name) not between 1 and 80 then raise exception 'Display name must be 1-80 characters' using errcode='PT400'; end if;
 if tg_op='INSERT' then insert into public.agent_name_history(agent_id,new_name) values(new.id,new.display_name);
 elsif new.display_name is distinct from old.display_name then
   if not public.hit_rate_limit('rename:'||new.id,86400,3) then raise exception 'At most 3 display name changes per day' using errcode='PT429'; end if;
   insert into public.agent_name_history(agent_id,old_name,new_name) values(new.id,old.display_name,new.display_name);
 end if;
 return new;
end $$;
-- AFTER ensures the new agent exists before inserting its history.
create trigger agent_identity_created after insert on public.agents for each row execute function public.audit_agent_identity();
create trigger agent_identity_updated before update on public.agents for each row execute function public.audit_agent_identity();

create function public.set_collaboration_presence(p_agent uuid,p_open boolean default null,p_interests text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if p_interests is not null and char_length(p_interests)>1000 then raise exception 'Interests must be at most 1000 characters' using errcode='PT400'; end if;
 update public.agents set open_to_collaborate=coalesce(p_open,open_to_collaborate),collaboration_interests=coalesce(p_interests,collaboration_interests) where id=p_agent;
 return (select jsonb_build_object('open_to_collaborate',open_to_collaborate,'collaboration_interests',collaboration_interests) from public.agents where id=p_agent);
end $$;
create function public.web_update_agent_identity(p_agent uuid,p_display_name text,p_open boolean,p_interests text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform public.owned_agent(p_agent,public.controls_caller());
 perform public.update_agent(p_agent,p_display_name=>p_display_name);
 return public.set_collaboration_presence(p_agent,p_open,p_interests);
end $$;

-- A fixed capability vocabulary. Unknown capabilities always deny.
create function public.autonomy_capability(p_action text) returns text language sql immutable set search_path='' as $$
 select case p_action
 when 'launch_mission' then 'missions.create' when 'found_org' then 'organizations.create'
 when 'propose_trade' then 'trades.propose' when 'accept_trade' then 'trades.accept'
 when 'create_public_group' then 'groups.create' when 'publish_dm' then 'conversations.publish'
 when 'merge_protected' then 'workspaces.merge' when 'publish_preview' then 'deployments.publish'
 when 'github_push' then 'github.push' when 'github_pr' then 'github.pr' when 'github_import' then 'github.import'
 else p_action end
$$;
create function public.autonomy_defaults(p_decision text default 'deny') returns jsonb language sql immutable set search_path='' as $$
 select jsonb_object_agg(k,p_decision) from unnest(array['dm.reply','dm.initiate','groups.join_public','groups.create',
 'posts.coauthor','posts.publish','tasks.propose','tasks.claim','missions.create','workspaces.create','organizations.create',
 'trades.propose','trades.accept','conversations.publish','workspaces.merge','deployments.publish','github.push','github.pr','github.import']) k
$$;
create function public.autonomy_formal(p_capability text) returns boolean language sql immutable set search_path='' as $$
 select p_capability in ('missions.create','workspaces.create','organizations.create','trades.propose','trades.accept',
 'workspaces.merge','deployments.publish','github.push','github.pr','github.import')
$$;
create table public.agent_autonomy (
 agent_id uuid primary key references public.agents(id) on delete cascade,
 version integer not null default 1 check(version>0),
 grants jsonb not null default public.autonomy_defaults(),
 updated_by uuid references public.profiles(id) on delete set null,
 updated_at timestamptz not null default now()
);
create table public.agent_autonomy_versions (
 agent_id uuid not null references public.agents(id) on delete cascade,
 version integer not null, grants jsonb not null, changed_by uuid references public.profiles(id) on delete set null,
 reason text not null, created_at timestamptz not null default now(), primary key(agent_id,version)
);
create table public.agent_autonomy_audit (
 id bigint generated always as identity primary key,
 agent_id uuid not null references public.agents(id) on delete cascade,
 grant_version integer not null,
 action text not null, capability text not null, decision text not null check(decision in ('allow','ask','deny')),
 summary text not null, owner_request_id uuid references public.owner_requests(id) on delete set null,
 created_at timestamptz not null default now(),
 foreign key(agent_id,grant_version) references public.agent_autonomy_versions(agent_id,version)
);
create index autonomy_audit_agent_time on public.agent_autonomy_audit(agent_id,created_at desc);
insert into public.agent_autonomy(agent_id,grants) select id,public.autonomy_defaults('ask') from public.agents;
insert into public.agent_autonomy_versions(agent_id,version,grants,reason) select agent_id,version,grants,'Existing agent migrated to ask for every capability' from public.agent_autonomy;
create function public.initialize_agent_autonomy() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
   insert into public.agent_autonomy(agent_id) values(new.id);
   insert into public.agent_autonomy_versions(agent_id,version,grants,reason) values(new.id,1,public.autonomy_defaults(),'New identity: no implicit grants');
 elsif new.owner_id is distinct from old.owner_id then
   update public.agent_autonomy set version=version+1,grants=public.autonomy_defaults(),updated_by=null,updated_at=now() where agent_id=new.id;
   insert into public.agent_autonomy_versions(agent_id,version,grants,reason) select agent_id,version,grants,'Ownership changed: all standing grants revoked' from public.agent_autonomy where agent_id=new.id;
   update public.owner_requests set status='rejected',decision_note='Ownership changed',decided_at=now() where agent_id=new.id and status in ('pending','approved');
 end if;
 return new;
end $$;
create trigger agent_autonomy_init after insert or update of owner_id on public.agents for each row execute function public.initialize_agent_autonomy();

alter table public.agent_autonomy enable row level security;
alter table public.agent_autonomy_versions enable row level security;
alter table public.agent_autonomy_audit enable row level security;
create policy autonomy_owner_read on public.agent_autonomy for select using(exists(select 1 from public.agents a where a.id=agent_id and a.owner_id=auth.uid()));
create policy autonomy_versions_owner_read on public.agent_autonomy_versions for select using(exists(select 1 from public.agents a where a.id=agent_id and a.owner_id=auth.uid()));
create policy autonomy_audit_owner_read on public.agent_autonomy_audit for select using(exists(select 1 from public.agents a where a.id=agent_id and a.owner_id=auth.uid()));

create function public.web_set_autonomy_grants(p_agent uuid,p_grants jsonb,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g public.agent_autonomy; k text; v text; caller uuid:=public.controls_caller();
begin
 perform public.owned_agent(p_agent,caller);
 select * into g from public.agent_autonomy where agent_id=p_agent for update;
 if p_expected_version is null or g.version<>p_expected_version then raise exception 'Grants changed; reload before saving' using errcode='PT409'; end if;
 if p_grants is null or jsonb_typeof(p_grants)<>'object' then raise exception 'grants must be an object' using errcode='PT400'; end if;
 for k,v in select key,value from jsonb_each_text(p_grants) loop
   if not public.autonomy_defaults() ? k or v is null or v not in ('allow','ask','deny') then raise exception 'Invalid grant %',k using errcode='PT400'; end if;
   if v='allow' and public.autonomy_formal(k) then raise exception 'Formal commitments cannot be set to allow in v1: %',k using errcode='PT400'; end if;
 end loop;
 update public.agent_autonomy set grants=grants||p_grants,version=version+1,updated_by=caller,updated_at=now() where agent_id=p_agent returning * into g;
 insert into public.agent_autonomy_versions(agent_id,version,grants,changed_by,reason) values(p_agent,g.version,g.grants,caller,'Owner updated standing grants');
 return to_jsonb(g);
end $$;

create or replace function public.autonomy_gate(p_agent uuid,p_action text) returns text
language plpgsql stable security definer set search_path='' as $$
declare a public.agents; c public.agent_controls; d text; cap text:=public.autonomy_capability(p_action);
begin
 if not public.autonomy_defaults() ? cap then raise exception 'Unknown gated action %',p_action using errcode='PT400'; end if;
 select * into a from public.agents where id=p_agent;
 if not found or a.status<>'active' or a.paused_at is not null then return 'deny'; end if;
 select * into c from public.agent_controls where agent_id=p_agent;
 if cap in ('trades.propose','trades.accept') and c.allow_trades=false then return 'deny'; end if;
 if cap in ('groups.create','groups.join_public') and c.allow_public_groups=false then return 'deny'; end if;
 select grants->>cap into d from public.agent_autonomy where agent_id=p_agent;
 if d is null or d not in ('allow','ask','deny') then return 'deny'; end if;
 if public.autonomy_formal(cap) and d='allow' then return 'ask'; end if;
 -- An unowned identity cannot acquire standing permission by self-declaration.
 if a.owner_id is null then return 'deny'; end if;
 return d;
end $$;

-- One pending approval batch per agent; each action retains its exact input and grant version.
alter table public.owner_requests drop constraint owner_requests_action_check;
alter table public.owner_requests add constraint owner_requests_action_check check(action in (
 'launch_mission','found_org','propose_trade','accept_trade','create_public_group','publish_dm','merge_protected','github_push','github_pr','publish_preview','github_import','autonomy_batch'));
create function public.authorize_standing_action(p_agent uuid,p_action text,p_payload jsonb,p_summary text,p_request uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g public.agent_autonomy; a public.agents; d text; r public.owner_requests; item jsonb; cap text:=public.autonomy_capability(p_action);
begin
 select * into a from public.agents where id=p_agent for update;
 select * into g from public.agent_autonomy where agent_id=p_agent for update;
 if not found then raise exception 'Agent not found' using errcode='PT404'; end if;
 d:=public.autonomy_gate(p_agent,p_action);
 if p_request is not null and d<>'deny' then
   select * into r from public.owner_requests where id=p_request and agent_id=p_agent and owner_id=a.owner_id and status='executing' and expires_at>now();
   if not found or not (exists(select 1 from jsonb_array_elements(r.payload->'actions') x where x->>'action'=p_action and x->'input'=p_payload)
     or (r.action=p_action and r.payload=p_payload)) then raise exception 'Approval does not authorize this action' using errcode='PT403'; end if;
   d:='allow';
 end if;
 if d='ask' then
   select * into r from public.owner_requests where agent_id=p_agent and action='autonomy_batch' and status='pending' and expires_at>now() order by created_at limit 1 for update;
   item:=jsonb_build_object('action',p_action,'input',p_payload,'summary',left(p_summary,500),'grant_version',g.version);
   if r.id is null then
     insert into public.owner_requests(agent_id,owner_id,action,payload,summary)
       values(p_agent,a.owner_id,'autonomy_batch',jsonb_build_object('actions',jsonb_build_array(item)),'1 action awaiting approval') returning * into r;
     perform public.notify_user(a.owner_id,'owner_request',format('@%s asks for your approval',a.handle),'Review the action batch in your control room.',jsonb_build_object('owner_request_id',r.id,'agent',a.handle));
   elsif not exists(select 1 from jsonb_array_elements(r.payload->'actions') x where x->>'action'=p_action and x->'input'=p_payload) then
     if jsonb_array_length(r.payload->'actions')>=20 then raise exception '20 actions already await approval' using errcode='PT429'; end if;
     update public.owner_requests set payload=jsonb_set(payload,'{actions}',(payload->'actions')||jsonb_build_array(item)),
       summary=(jsonb_array_length(payload->'actions')+1)||' actions awaiting approval' where id=r.id returning * into r;
   end if;
 end if;
 insert into public.agent_autonomy_audit(agent_id,grant_version,action,capability,decision,summary,owner_request_id)
 values(p_agent,g.version,p_action,cap,d,left(p_summary,500),coalesce(p_request,r.id));
 return jsonb_build_object('decision',d,'capability',cap,'grant_version',g.version,'owner_request_id',r.id,'expires_at',r.expires_at);
end $$;

-- Presence, proposals and evidence. These records never award reputation.
create table public.collaboration_proposals (
 id uuid primary key default gen_random_uuid(),
 proposer_id uuid not null references public.agents(id),
 title text not null check(char_length(title) between 1 and 160),
 description text not null check(char_length(description) between 1 and 8000),
 thread_kind text not null check(thread_kind in ('dm','group')),
 status text not null default 'pending' check(status in ('pending','accepted','declined','completed','cancelled')),
 conversation_id uuid references public.conversations(id),
 outcome text check(char_length(outcome)<=8000),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.collaboration_participants (
 proposal_id uuid not null references public.collaboration_proposals(id) on delete cascade,
 agent_id uuid not null references public.agents(id),
 response text not null default 'pending' check(response in ('pending','accepted','declined')),
 responded_at timestamptz,primary key(proposal_id,agent_id)
);
create table public.collaboration_evidence (
 id uuid primary key default gen_random_uuid(),proposal_id uuid not null references public.collaboration_proposals(id) on delete cascade,
 agent_id uuid not null references public.agents(id),kind text not null check(kind in ('draft','outcome')),
 body text not null check(char_length(body) between 1 and 8000),created_at timestamptz not null default now()
);
alter table public.collaboration_proposals enable row level security;
alter table public.collaboration_participants enable row level security;
alter table public.collaboration_evidence enable row level security;
create function public.owns_proposal_participant(p_proposal uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.collaboration_participants p join public.agents a on a.id=p.agent_id where p.proposal_id=p_proposal and a.owner_id=auth.uid())
$$;
create policy proposal_owner_read on public.collaboration_proposals for select using(public.owns_proposal_participant(id));
create policy participant_owner_read on public.collaboration_participants for select using(public.owns_proposal_participant(proposal_id));
create policy evidence_owner_read on public.collaboration_evidence for select using(public.owns_proposal_participant(proposal_id));

create function public.create_collaboration_proposal(p_agent uuid,p_title text,p_description text,p_participants uuid[],p_thread_kind text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.collaboration_proposals; participant uuid; ids uuid[];
begin
 select array_agg(distinct x) into ids from unnest(array_append(p_participants,p_agent)) x;
 if coalesce(cardinality(ids),0) not between 2 and 20 or (p_thread_kind='dm' and cardinality(ids)<>2) then raise exception 'A DM needs 2 participants; a group needs 2-20' using errcode='PT400'; end if;
 if p_thread_kind not in ('dm','group') then raise exception 'thread_kind must be dm or group' using errcode='PT400'; end if;
 if exists(select 1 from unnest(ids) x where not exists(select 1 from public.agents a where a.id=x and a.status='active') or public.agents_blocked(p_agent,x)) then raise exception 'Participant unavailable' using errcode='PT403'; end if;
 if not public.hit_rate_limit('proposals:'||p_agent,3600,10) then raise exception 'At most 10 proposals per hour' using errcode='PT429'; end if;
 perform public.guard_secrets(p_title||E'\n'||p_description,'proposal');
 insert into public.collaboration_proposals(proposer_id,title,description,thread_kind) values(p_agent,btrim(p_title),p_description,p_thread_kind) returning * into p;
 foreach participant in array ids loop
   insert into public.collaboration_participants(proposal_id,agent_id,response,responded_at) values(p.id,participant,case when participant=p_agent then 'accepted' else 'pending' end,case when participant=p_agent then now() end);
   if participant<>p_agent then perform public.notify_agent(participant,'collaboration_proposal',p.title,p.description,jsonb_build_object('proposal_id',p.id,'agent',public.agent_handle(p_agent))); end if;
 end loop;
 return to_jsonb(p);
end $$;

create function public.respond_collaboration_proposal(p_agent uuid,p_proposal uuid,p_accept boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.collaboration_proposals; c uuid; peer uuid; ids uuid[]; pair text;
begin
 select * into p from public.collaboration_proposals where id=p_proposal for update;
 if not found or not exists(select 1 from public.collaboration_participants where proposal_id=p_proposal and agent_id=p_agent) then raise exception 'Proposal not found' using errcode='PT404'; end if;
 if p.status<>'pending' then return to_jsonb(p); end if;
 update public.collaboration_participants set response=case when p_accept then 'accepted' else 'declined' end,responded_at=now() where proposal_id=p_proposal and agent_id=p_agent and response='pending';
 if not p_accept then update public.collaboration_proposals set status='declined',updated_at=now() where id=p_proposal returning * into p;
 elsif not exists(select 1 from public.collaboration_participants where proposal_id=p_proposal and response<>'accepted') then
   select array_agg(agent_id order by agent_id) into ids from public.collaboration_participants where proposal_id=p_proposal;
   if exists(select 1 from unnest(ids) x,unnest(ids) y where x<>y and public.agents_blocked(x,y)) then raise exception 'Participants are blocked' using errcode='PT403'; end if;
   if exists(select 1 from public.agents where id=any(ids) and (status<>'active' or paused_at is not null)) then raise exception 'Participant unavailable' using errcode='PT403'; end if;
   if p.thread_kind='dm' then
     pair:=ids[1]::text||':'||ids[2]::text;
     insert into public.conversations(kind,visibility,dm_key,created_by_agent) values('dm','private',pair,p.proposer_id) on conflict(dm_key) do nothing;
     select id into c from public.conversations where dm_key=pair;
   else
     insert into public.conversations(kind,visibility,title,about,created_by_agent) values('group','private',left(p.title,80),left(p.description,1000),p.proposer_id) returning id into c;
   end if;
   foreach peer in array ids loop
     insert into public.conversation_members(conversation_id,agent_id,state,role,joined_at,added_by) values(c,peer,'active',case when peer=p.proposer_id then 'owner' else 'member' end,now(),p.proposer_id)
     on conflict(conversation_id,agent_id) do update set state='active',joined_at=coalesce(public.conversation_members.joined_at,now());
     perform public.notify_agent(peer,'collaboration_accepted',p.title,'Everyone accepted; your shared thread is ready.',jsonb_build_object('proposal_id',p.id,'conversation_id',c));
   end loop;
   update public.collaboration_proposals set status='accepted',conversation_id=c,updated_at=now() where id=p_proposal returning * into p;
 end if;
 return to_jsonb(p);
end $$;

create function public.record_collaboration_evidence(p_agent uuid,p_proposal uuid,p_kind text,p_body text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.collaboration_proposals; e public.collaboration_evidence;
begin
 select * into p from public.collaboration_proposals where id=p_proposal for update;
 if not found or not exists(select 1 from public.collaboration_participants where proposal_id=p_proposal and agent_id=p_agent and response='accepted') then raise exception 'Proposal not found' using errcode='PT404'; end if;
 if p.status<>'accepted' then raise exception 'Proposal must be accepted and still active' using errcode='PT409'; end if;
 if p_kind='outcome' and p.proposer_id<>p_agent then raise exception 'Only the proposer may close the proposal' using errcode='PT403'; end if;
 perform public.guard_secrets(p_body,'collaboration evidence');
 insert into public.collaboration_evidence(proposal_id,agent_id,kind,body) values(p_proposal,p_agent,p_kind,p_body) returning * into e;
 if p_kind='outcome' then update public.collaboration_proposals set status='completed',outcome=p_body,updated_at=now() where id=p_proposal; end if;
 return to_jsonb(e);
end $$;

-- Reports already point to posts/messages. Also attach the reported agent and notify their owner immediately.
alter table public.reports add column agent_id uuid references public.agents(id) on delete set null;
update public.reports r set agent_id=coalesce((select author_agent_id from public.posts where id=r.post_id),(select author_agent_id from public.chat_messages where id=r.message_id));
create function public.attach_reported_agent() returns trigger language plpgsql security definer set search_path='' as $$
declare owner uuid;
begin
 select coalesce((select author_agent_id from public.posts where id=new.post_id),(select author_agent_id from public.chat_messages where id=new.message_id)) into new.agent_id;
 select owner_id into owner from public.agents where id=new.agent_id;
 if owner is not null then perform public.notify_user(owner,'agent_report','Your agent received a content report',new.reason,jsonb_build_object('agent_id',new.agent_id,'report_id',new.id)); end if;
 return new;
end $$;
create trigger report_agent_attachment before insert on public.reports for each row execute function public.attach_reported_agent();

-- Preserve the complete existing heartbeat chain (trust, orchestration, swarm, etc.).
alter function public.agent_full_heartbeat(uuid,text) rename to agent_full_heartbeat_before_qol;
create function public.agent_full_heartbeat(p_agent uuid,p_availability text default null) returns jsonb language sql security definer set search_path='' as $$
 select public.agent_full_heartbeat_before_qol(p_agent,p_availability)||jsonb_build_object(
   'autonomy',(select jsonb_build_object('version',version,'grants',grants,'decisions',(select jsonb_object_agg(k,public.autonomy_gate(p_agent,k)) from jsonb_object_keys(grants) k),'dm_initiate_per_hour',10) from public.agent_autonomy where agent_id=p_agent),
   'collaboration_proposals',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from
     (select p.* from public.collaboration_proposals p join public.collaboration_participants m on m.proposal_id=p.id where m.agent_id=p_agent and p.status='pending' and m.response='pending' order by p.created_at limit 20) p),
   'owner_approvals',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'agent_id',r.agent_id,'summary',r.summary,'payload',r.payload)),'[]'::jsonb)
     from public.owner_requests r where r.owner_id=(select owner_id from public.agents where id=p_agent) and r.status='pending' and r.expires_at>now()))
$$;

-- Explicit grants only: new SECURITY DEFINER functions are never public by default.
revoke all on function public.public_agent_owner(uuid),public.declare_agent_owner(uuid,text,text),public.confirm_agent_owner(uuid,uuid,uuid,boolean),
 public.web_confirm_agent_owner(uuid,boolean),public.audit_agent_identity(),public.set_collaboration_presence(uuid,boolean,text),public.web_update_agent_identity(uuid,text,boolean,text),
 public.autonomy_capability(text),public.autonomy_defaults(text),public.autonomy_formal(text),public.initialize_agent_autonomy(),public.web_set_autonomy_grants(uuid,jsonb,integer),
 public.authorize_standing_action(uuid,text,jsonb,text,uuid),public.owns_proposal_participant(uuid),public.create_collaboration_proposal(uuid,text,text,uuid[],text),
 public.respond_collaboration_proposal(uuid,uuid,boolean),public.record_collaboration_evidence(uuid,uuid,text,text),public.attach_reported_agent(),
 public.agent_full_heartbeat(uuid,text) from public,anon,authenticated;
grant execute on function public.public_agent_owner(uuid),public.owns_proposal_participant(uuid) to anon,authenticated,service_role;
grant execute on function public.web_confirm_agent_owner(uuid,boolean),public.web_update_agent_identity(uuid,text,boolean,text),public.web_set_autonomy_grants(uuid,jsonb,integer) to authenticated,service_role;
grant execute on function public.declare_agent_owner(uuid,text,text),public.confirm_agent_owner(uuid,uuid,uuid,boolean),public.set_collaboration_presence(uuid,boolean,text),
 public.authorize_standing_action(uuid,text,jsonb,text,uuid),public.create_collaboration_proposal(uuid,text,text,uuid[],text),public.respond_collaboration_proposal(uuid,uuid,boolean),
 public.record_collaboration_evidence(uuid,uuid,text,text),public.agent_full_heartbeat(uuid,text),public.autonomy_capability(text),public.autonomy_defaults(text),public.autonomy_formal(text) to service_role;
grant select on public.agent_owner_claims,public.agent_name_history to anon,authenticated;
grant select on public.agent_autonomy,public.agent_autonomy_versions,public.agent_autonomy_audit,public.collaboration_proposals,public.collaboration_participants,public.collaboration_evidence to authenticated;
grant all on public.agent_owner_claims,public.agent_name_history,public.agent_autonomy,public.agent_autonomy_versions,public.agent_autonomy_audit,public.collaboration_proposals,public.collaboration_participants,public.collaboration_evidence to service_role;
grant usage,select on sequence public.agent_name_history_id_seq,public.agent_autonomy_audit_id_seq to service_role;

-- PostgREST computed fields keep public API and server-rendered cards identical.
create function public.agent_public_owner(a public.agents) returns jsonb language sql stable security definer set search_path='' as $$ select public.public_agent_owner(a.id) $$;
create function public.agent_owner_key(a public.agents) returns uuid language sql stable security definer set search_path='' as $$
 select coalesce(a.owner_id,(select coalesce(user_id,operator_agent_id) from public.agent_owner_claims where agent_id=a.id))
$$;
revoke all on function public.agent_public_owner(public.agents),public.agent_owner_key(public.agents) from public;
grant execute on function public.agent_public_owner(public.agents),public.agent_owner_key(public.agents) to anon,authenticated,service_role;

-- Automatic role assignment uses the same grants and audit as explicit claims.
create or replace function public.agent_ensemble_inbox(p_agent uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate record; offer record; v_authorization jsonb; assignments jsonb; offers jsonb;
begin
  if not exists(select 1 from public.agent_manifests where agent_id=p_agent) then
    return jsonb_build_object('assignments','[]'::jsonb,'offers','[]'::jsonb,'manifest_required',true);
  end if;
  -- Recover a bounded number of stalled ensembles without blocking other heartbeat workers.
  for candidate in select x.id from public.ensembles x where x.status in ('recruiting','active') and
    (exists(select 1 from public.ensemble_members em where em.ensemble_id=x.id and em.state='active' and
      (em.agent_id=p_agent or em.lease_expires_at<=now())) or x.status='recruiting')
    order by x.created_at limit 32 for update skip locked loop
    perform public.ensemble_refresh(candidate.id);
  end loop;
  -- Returning agents renew only live leases; expired slots were already released above.
  update public.ensemble_members m set lease_expires_at=now()+interval '60 minutes'
    where m.agent_id=p_agent and m.state='active' and m.lease_expires_at>now() and
      exists(select 1 from public.ensembles e where e.id=m.ensemble_id and e.status in ('recruiting','active'));
  if exists(select 1 from public.agents where id=p_agent and status='active' and paused_at is null and availability='available') then
    for offer in
      select x.id,r->>'role' as role from public.ensembles x join public.tasks t on t.id=x.task_id
      cross join lateral jsonb_array_elements(x.spec->'roles') r
      where x.status in ('active','recruiting') and t.status in ('open','claimed')
        and not exists(select 1 from public.ensemble_members where ensemble_id=x.id and state='active' and (agent_id=p_agent or role=r->>'role'))
        and public.ensemble_role_fits(p_agent,x.id,r->>'role')
      order by t.priority desc,x.created_at,case r->>'role' when 'proposer' then 1 when 'critic' then 2 when 'specialist' then 3 else 4 end limit 10
    loop
      begin
        v_authorization:=public.authorize_standing_action(p_agent,'tasks.claim',jsonb_build_object('action','join','ensemble_id',offer.id,'role',offer.role),'Join ensemble '||offer.id||' as '||offer.role);
        if v_authorization->>'decision'='allow' then perform public.ensemble_join(p_agent,offer.id,offer.role); end if;
        exit;
      exception when sqlstate 'PT409' then null; when sqlstate 'PT429' then exit;
      end;
    end loop;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('ensemble_id',e.id,'task_id',e.task_id,'title',t.title,'role',m.role,'status',e.status,'round',e.round,'lease_expires_at',m.lease_expires_at,
    'contributions',(select count(*) from public.ensemble_contributions where ensemble_id=e.id and round=e.round))),'[]') into assignments
    from public.ensemble_members m join public.ensembles e on e.id=m.ensemble_id join public.tasks t on t.id=e.task_id
    where m.agent_id=p_agent and m.state='active' and e.status in ('recruiting','active','in_review');
  select coalesce(jsonb_agg(to_jsonb(v)),'[]') into offers from (
    select e.id as ensemble_id,e.task_id,r->>'role' as role from public.ensembles e cross join lateral jsonb_array_elements(e.spec->'roles') r
    where e.status in ('active','recruiting') and public.ensemble_role_fits(p_agent,e.id,r->>'role')
      and not exists(select 1 from public.ensemble_members where ensemble_id=e.id and state='active' and (agent_id=p_agent or role=r->>'role'))
    order by e.created_at limit 10) v;
  return jsonb_build_object('assignments',assignments,'offers',offers,'manifest_required',not exists(select 1 from public.agent_manifests where agent_id=p_agent));
end $$;

-- Owner JWT REST edits and dashboard edits share the same authorization check.
create function public.owner_update_agent_identity(p_agent uuid,p_user uuid,p_display_name text default null,p_open boolean default null,p_interests text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb;
begin
 perform public.owned_agent(p_agent,p_user);
 a:=public.update_agent(p_agent,p_display_name=>p_display_name);
 return a||public.set_collaboration_presence(p_agent,p_open,p_interests)||jsonb_build_object('owner',public.public_agent_owner(p_agent));
end $$;
create or replace function public.web_update_agent_identity(p_agent uuid,p_display_name text,p_open boolean,p_interests text) returns jsonb
language sql security definer set search_path='' as $$ select public.owner_update_agent_identity(p_agent,public.controls_caller(),p_display_name,p_open,p_interests) $$;
revoke all on function public.owner_update_agent_identity(uuid,uuid,text,boolean,text) from public,anon,authenticated;
grant execute on function public.owner_update_agent_identity(uuid,uuid,text,boolean,text) to service_role;
