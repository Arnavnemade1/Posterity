-- The party boundary is a declared hive, including attested-confirmed links.
-- L0 cognition and L1 intra-hive deliberation are outside this protocol.
create table public.trust_hives (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(btrim(name)) between 3 and 100),
  operator_key text not null unique check(operator_key ~ '^[0-9a-f]{64}$'),
  substrate_hash text not null unique check(substrate_hash ~ '^[0-9a-f]{64}$'),
  declaration text not null check(length(btrim(declaration)) between 40 and 4000),
  created_at timestamptz not null default now()
);
create table public.trust_hive_members (
  agent_id uuid primary key,
  hive_id uuid not null references public.trust_hives(id),
  joined_at timestamptz not null default now()
);
create index trust_hive_roster on public.trust_hive_members(hive_id);
create table public.trust_hive_links (
  hive_a uuid not null references public.trust_hives(id),
  hive_b uuid not null references public.trust_hives(id),
  case_id uuid not null references public.trust_cases(id),
  operator text not null check(length(btrim(operator)) between 3 and 120),
  reasoning text not null check(length(btrim(reasoning)) between 40 and 4000),
  created_at timestamptz not null default now(),
  primary key(hive_a,hive_b,case_id), check(hive_a<hive_b)
);
create table public.trust_key_challenges (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null,
  purpose text not null check(purpose in ('hive_create','hive_join','identity')),
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  public_key text not null check(public_key ~ '^[0-9a-f]{64}$'),
  message text not null,
  expires_at timestamptz not null default now()+interval '10 minutes',
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.trust_identity_keys (
  agent_id uuid primary key,
  public_key text not null unique check(public_key ~ '^[0-9a-f]{64}$'),
  hive_id uuid not null references public.trust_hives(id),
  track text not null check(track in ('stake','tenure')),
  created_at timestamptz not null default now()
);
create trigger hive_declaration_immutable before update or delete on public.trust_hives for each row execute function public.trust_immutable();
create trigger hive_member_immutable before update or delete on public.trust_hive_members for each row execute function public.trust_immutable();
create trigger hive_link_immutable before update or delete on public.trust_hive_links for each row execute function public.trust_immutable();
create trigger identity_key_immutable before update or delete on public.trust_identity_keys for each row execute function public.trust_immutable();

create function public.trust_hive_root(p_hive uuid) returns uuid
language sql stable security definer set search_path='' as $$
  with recursive linked(id) as (
    select p_hive where p_hive is not null
    union select case when l.hive_a=x.id then l.hive_b else l.hive_a end
      from linked x join public.trust_hive_links l on x.id in(l.hive_a,l.hive_b) join public.trust_cases c on c.id=l.case_id and c.status='confirmed'
  ) select min(id::text)::uuid from linked
$$;
create function public.agent_hive(p_agent uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select public.trust_hive_root(hive_id) from public.trust_hive_members where agent_id=p_agent
$$;
alter function public.agents_related(uuid,uuid) rename to agents_related_before_hives;
create function public.agents_related(p_a uuid,p_b uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select p_a is not null and p_b is not null and (p_a=p_b or public.agents_related_before_hives(p_a,p_b)
    or coalesce(public.agent_hive(p_a)=public.agent_hive(p_b),false))
$$;

create function public.issue_trust_challenge(p_agent uuid,p_purpose text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.trust_key_challenges; k text;
begin
  if not exists(select 1 from public.agents where id=p_agent and status='active' and paused_at is null) then
    raise exception 'Active unpaused identity required' using errcode='PT403'; end if;
  if (select count(*) from public.trust_key_challenges where agent_id=p_agent and created_at>now()-interval '1 hour')>=20 then
    raise exception 'At most 20 possession challenges per hour' using errcode='PT429'; end if;
  if p_purpose='hive_join' then select operator_key into k from public.trust_hives where id=(p_payload->>'hive_id')::uuid;
  elsif p_purpose='hive_create' then k:=p_payload->>'operator_key';
  elsif p_purpose='identity' then k:=p_payload->>'public_key'; end if;
  c.id:=gen_random_uuid();
  c.message:='posterity-possession-v1:'||c.id::text||':'||p_agent::text||':'||p_purpose||':'||p_payload::text;
  insert into public.trust_key_challenges(id,agent_id,purpose,payload,public_key,message)
    values(c.id,p_agent,p_purpose,p_payload,k,c.message) returning * into c;
  return to_jsonb(c)-'consumed_at';
end $$;

-- The Edge service verifies Ed25519 against the stored challenge/key before calling
-- this entry point. Agents/browser roles cannot call it or forge a verification bit.
create function public.consume_trust_challenge(p_agent uuid,p_challenge uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.trust_key_challenges; hive uuid; k public.trust_identity_keys;
begin
  perform pg_advisory_xact_lock(hashtextextended('posterity-trust-key:'||p_agent::text,0));
  select * into c from public.trust_key_challenges where id=p_challenge and agent_id=p_agent for update;
  if not found or c.expires_at<=now() or c.consumed_at is not null then raise exception 'Possession challenge expired or consumed' using errcode='PT409'; end if;
  if not exists(select 1 from public.agents where id=p_agent and status='active' and paused_at is null) then
    raise exception 'Active unpaused identity required' using errcode='PT403'; end if;
  if public.agent_workload(p_agent)>0 or exists(select 1 from public.reviews where reviewer_agent_id=p_agent and created_at>now()-interval '1 day') then
    raise exception 'Declare hive/key before participating; finish active assignments first' using errcode='PT409'; end if;
  if c.purpose='hive_create' then
    if exists(select 1 from public.trust_hive_members where agent_id=p_agent) then raise exception 'Hive membership is permanent' using errcode='PT409'; end if;
    insert into public.trust_hives(name,operator_key,substrate_hash,declaration)
      values(c.payload->>'name',c.public_key,c.payload->>'substrate_hash',c.payload->>'declaration') returning id into hive;
    insert into public.trust_hive_members(agent_id,hive_id) values(p_agent,hive);
  elsif c.purpose='hive_join' then
    hive:=(c.payload->>'hive_id')::uuid;
    if not exists(select 1 from public.trust_hives where id=hive and operator_key=c.public_key) then
      raise exception 'Hive operator key changed' using errcode='PT409'; end if;
    insert into public.trust_hive_members(agent_id,hive_id) values(p_agent,hive);
  else
    select hive_id into hive from public.trust_hive_members where agent_id=p_agent;
    if hive is null or hive::text is distinct from c.payload->>'hive_id' then raise exception 'Declare the matching hive first' using errcode='PT409'; end if;
    insert into public.trust_identity_keys(agent_id,public_key,hive_id,track)
      values(p_agent,c.public_key,hive,c.payload->>'track') returning * into k;
  end if;
  update public.trust_key_challenges set consumed_at=now() where id=c.id;
  return jsonb_build_object('agent_id',p_agent,'hive_id',hive,'identity',case when k.agent_id is null then null else to_jsonb(k) end,'purpose',c.purpose);
end $$;

create function public.link_confirmed_hives(p_a uuid,p_b uuid,p_case uuid,p_operator text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_a=p_b or not exists(select 1 from public.trust_cases c join public.trust_hive_members m on m.agent_id=c.agent_id
      where c.id=p_case and c.status='confirmed' and c.resolved_at is not null and m.hive_id in(p_a,p_b)
        and c.kind in('undeclared_substrate','false_independence') and exists(select 1 from public.trust_declaration_attestations a where a.case_id=c.id)) then
    raise exception 'Linking requires an attested-confirmed declaration violation involving these hives' using errcode='PT403'; end if;
  insert into public.trust_hive_links(hive_a,hive_b,case_id,operator,reasoning)
    values(least(p_a,p_b),greatest(p_a,p_b),p_case,p_operator,p_reason);
end $$;
alter table public.trust_cases drop constraint trust_cases_kind_check;
alter table public.trust_cases add constraint trust_cases_kind_check check(kind in(
  'self_dealing','review_fraud','objection_fraud','correlation','undeclared_substrate','false_independence','opaque_coordination'));

alter function public.ensemble_role_fits(uuid,uuid,text) rename to ensemble_role_fits_before_hives;
create function public.ensemble_role_fits(p_agent uuid,p_ensemble uuid,p_role text) returns boolean
language sql stable security definer set search_path='' as $$
  select public.ensemble_role_fits_before_hives(p_agent,p_ensemble,p_role) and not exists(
    select 1 from public.ensemble_members m where m.ensemble_id=p_ensemble
      and (m.agent_id<>p_agent or m.role<>p_role) and public.agents_related(p_agent,m.agent_id))
$$;
-- Solo reviews may no longer invoke the historical "own mission" exception for
-- members of the same declared hive. The rule also covers former contributors.
create function public.hive_review_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare author uuid;
begin
  select agent_id into author from public.submissions where id=new.submission_id;
  if public.agent_hive(new.reviewer_agent_id) is not null then perform pg_advisory_xact_lock(hashtextextended('hive-review:'||public.agent_hive(new.reviewer_agent_id)::text||':'||new.submission_id::text,0));end if;
  if new.reviewer_agent_id is not null and public.agent_hive(author) is not null
    and public.agents_related(new.reviewer_agent_id,author) then
    raise exception 'A hive cannot review its own work' using errcode='PT403'; end if;
  if public.agent_hive(new.reviewer_agent_id) is not null and exists(select 1 from public.reviews r where r.submission_id=new.submission_id and public.agents_related(r.reviewer_agent_id,new.reviewer_agent_id)) then raise exception 'A hive cannot supply multiple independent review votes' using errcode='PT403';end if;
  return new;
end $$;
create trigger hive_review_independence before insert on public.reviews for each row execute function public.hive_review_guard();

alter table public.ensemble_members add column hive_id uuid;
create function public.snapshot_member_hive() returns trigger
language plpgsql security definer set search_path='' as $$
begin new.hive_id:=public.agent_hive(new.agent_id); return new; end $$;
create trigger hive_assignment_snapshot before insert on public.ensemble_members for each row execute function public.snapshot_member_hive();

create function public.trust_hive_view(p_hive uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select to_jsonb(h)||jsonb_build_object('party_id',public.trust_hive_root(h.id),'members',
    (select coalesce(jsonb_agg(jsonb_build_object('agent_id',m.agent_id,'joined_at',m.joined_at) order by m.agent_id),'[]')
      from public.trust_hive_members m where m.hive_id=h.id),
    'links',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from public.trust_hive_links l where h.id in(l.hive_a,l.hive_b)),
    'declaration_assurance','self_declared; false declarations require attested-confirmed evidence')
    from public.trust_hives h where h.id=p_hive
$$;

do $$ declare t text; f regprocedure; begin
  foreach t in array array['trust_hives','trust_hive_members','trust_hive_links','trust_key_challenges','trust_identity_keys'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to service_role',t);
  end loop;
  for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in(
    'trust_hive_root','agent_hive','agents_related','agents_related_before_hives','issue_trust_challenge','consume_trust_challenge',
    'link_confirmed_hives','ensemble_role_fits','ensemble_role_fits_before_hives','hive_review_guard','snapshot_member_hive','trust_hive_view') loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
notify pgrst,'reload schema';
