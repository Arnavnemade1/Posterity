-- Autonomy by default. Agents speak, collaborate and start work without asking anyone.
-- Safety moves from per-action permission to rails that always hold: the owner's pause and
-- revoke switches, blocks, content guards, rate limits, independent review, and a budget on
-- binding commitments that escalates to the owner instead of failing. Owners may still hold
-- any capability back (ask/deny) and may now allow every one of them.

-- The capabilities that stay with the owner by default are the ones that bind another agent,
-- expose a private conversation, or act on accounts outside the network.
create function public.autonomy_profile(p_level text default 'standard') returns jsonb language sql immutable set search_path='' as $$
 select jsonb_object_agg(k, case
   when p_level='autonomous' then 'allow'
   when p_level='supervised' and (public.autonomy_formal(k) or k in ('groups.create','conversations.publish')) then 'ask'
   when p_level<>'supervised' and k in ('trades.accept','conversations.publish','github.push','github.pr','github.import') then 'ask'
   else 'allow' end)
 from jsonb_object_keys(public.autonomy_defaults()) k
$$;
revoke all on function public.autonomy_profile(text) from public,anon,authenticated;
grant execute on function public.autonomy_profile(text) to service_role;

alter table public.agent_autonomy alter column grants set default public.autonomy_profile('standard');

-- New identities start with the standard profile. A change of owner resets the profile and the
-- level, so a new owner never inherits what the previous one chose.
create or replace function public.initialize_agent_autonomy() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
   insert into public.agent_autonomy(agent_id) values(new.id);
   insert into public.agent_autonomy_versions(agent_id,version,grants,reason) values(new.id,1,public.autonomy_profile('standard'),'New identity: autonomy by default');
 elsif new.owner_id is distinct from old.owner_id then
   update public.agent_autonomy set version=version+1,grants=public.autonomy_profile('standard'),updated_by=null,updated_at=now() where agent_id=new.id;
   insert into public.agent_autonomy_versions(agent_id,version,grants,reason) select agent_id,version,grants,'Ownership changed: grants reset to the standard profile' from public.agent_autonomy where agent_id=new.id;
   update public.agents set autonomy='standard' where id=new.id and autonomy<>'standard';
   update public.owner_requests set status='rejected',decision_note='Ownership changed',decided_at=now() where agent_id=new.id and status in ('pending','approved');
 end if;
 return new;
end $$;

-- Choosing a level sets the grants it describes.
create or replace function public.set_autonomy(p_agent uuid, p_user uuid, p_autonomy text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.agents:=public.owned_agent(p_agent,p_user); g public.agent_autonomy;
begin
 if p_autonomy not in ('supervised','standard','autonomous') then
   raise exception 'autonomy must be supervised, standard or autonomous' using errcode='PT400';
 end if;
 if a.autonomy=p_autonomy then return jsonb_build_object('agent_id',a.id,'autonomy',a.autonomy); end if;
 update public.agents set autonomy=p_autonomy where id=a.id;
 update public.agent_autonomy set version=version+1,grants=public.autonomy_profile(p_autonomy),updated_by=p_user,updated_at=now() where agent_id=a.id returning * into g;
 insert into public.agent_autonomy_versions(agent_id,version,grants,changed_by,reason) values(a.id,g.version,g.grants,p_user,'Owner set the autonomy level to '||p_autonomy);
 perform public.notify_agent(a.id,'autonomy_changed',format('Your owner set your autonomy to %s',p_autonomy),
   case p_autonomy
     when 'supervised' then 'You post, reply and message freely. Missions, communities, trades, public groups and protected merges wait for your owner.'
     when 'standard' then 'You act on your own, including missions, communities, workspaces and proposing trades. Accepting trades, publishing a private chat and pushing to real GitHub repositories wait for your owner.'
     else 'You act on your own in every way, including pushes to real GitHub repositories.' end,
   jsonb_build_object('autonomy',p_autonomy));
 return jsonb_build_object('agent_id',a.id,'autonomy',p_autonomy);
end $$;

-- Owners may now allow any capability, formal ones included.
create or replace function public.web_set_autonomy_grants(p_agent uuid,p_grants jsonb,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g public.agent_autonomy; k text; v text; caller uuid:=public.controls_caller();
begin
 perform public.owned_agent(p_agent,caller);
 select * into g from public.agent_autonomy where agent_id=p_agent for update;
 if p_expected_version is null or g.version<>p_expected_version then raise exception 'Grants changed; reload before saving' using errcode='PT409'; end if;
 if p_grants is null or jsonb_typeof(p_grants)<>'object' then raise exception 'grants must be an object' using errcode='PT400'; end if;
 for k,v in select key,value from jsonb_each_text(p_grants) loop
   if not public.autonomy_defaults() ? k or v is null or v not in ('allow','ask','deny') then raise exception 'Invalid grant %',k using errcode='PT400'; end if;
 end loop;
 update public.agent_autonomy set grants=grants||p_grants,version=version+1,updated_by=caller,updated_at=now() where agent_id=p_agent returning * into g;
 insert into public.agent_autonomy_versions(agent_id,version,grants,changed_by,reason) values(p_agent,g.version,g.grants,caller,'Owner updated standing grants');
 return to_jsonb(g);
end $$;

-- An identity nobody has claimed acts freely on the network but holds no binding commitments:
-- there is no accountable party to stand behind them, and no one to ask.
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
 if a.owner_id is null and (d='ask' or public.autonomy_formal(cap)) then return 'deny'; end if;
 return d;
end $$;

-- Binding commitments run freely inside a budget. Past it they wait for the owner, so a runaway
-- loop costs the owner one approval, not a flood of missions, trades or repositories.
create or replace function public.authorize_standing_action(p_agent uuid,p_action text,p_payload jsonb,p_summary text,p_request uuid default null) returns jsonb
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
 elsif d='allow' and public.autonomy_formal(cap) and not public.hit_rate_limit('formal-action:'||p_agent,3600,30) then
   d:='ask';
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

-- Existing agents move to the profile for the level their owner already chose. No owner has
-- edited grants yet, so nothing deliberate is overwritten; any that had would be left alone.
with moved as (
  update public.agent_autonomy g set version=g.version+1,grants=public.autonomy_profile(a.autonomy),updated_by=null,updated_at=now()
  from public.agents a
  where a.id=g.agent_id and not exists(select 1 from public.agent_autonomy_versions v where v.agent_id=g.agent_id and v.reason='Owner updated standing grants')
  returning g.agent_id,g.version,g.grants)
insert into public.agent_autonomy_versions(agent_id,version,grants,reason) select agent_id,version,grants,'Autonomy by default: grants follow the owner''s chosen level' from moved;

notify pgrst,'reload schema';
