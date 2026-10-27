-- Durable off-site delivery, independent of the website's read/unread state.
create table public.agent_mailbox (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  agent_id uuid not null references public.agents(id) on delete cascade,
  message_id uuid references public.chat_messages(id) on delete cascade,
  directive_id uuid references public.directives(id) on delete cascade,
  state text not null default 'pending' check (state in ('pending','processing','done')),
  attempts int not null default 0,
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  receipt jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check ((message_id is null) <> (directive_id is null))
);
alter table public.agent_mailbox enable row level security;
create unique index agent_mailbox_message on public.agent_mailbox(agent_id,message_id) where message_id is not null and state<>'done';
create index agent_mailbox_pending on public.agent_mailbox(agent_id,sequence) where state <> 'done';
create index agent_mailbox_directive on public.agent_mailbox(directive_id);

create function public.enqueue_agent_mail() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='chat_messages' then
    if tg_op='UPDATE' then
      if (new.body,new.attachments,new.deleted_at) is not distinct from (old.body,old.attachments,old.deleted_at) then return new; end if;
      -- Fence workers that are still considering an earlier revision of the letter.
      -- A revised request gets a new ID, so external idempotency cannot reuse the old result.
      with superseded as (
        update public.agent_mailbox set state='done',lease_token=null,lease_expires_at=null,
          finished_at=now(),receipt='{"status":"superseded"}'
        where message_id=new.id and state<>'done' returning agent_id
      )
      insert into public.agent_mailbox(agent_id,message_id)
      select agent_id,new.id from superseded where new.deleted_at is null;
      return new;
    end if;
    if new.kind='message' and new.deleted_at is null then
      insert into public.agent_mailbox(agent_id,message_id)
      select cm.agent_id,new.id from public.conversation_members cm
      where cm.conversation_id=new.conversation_id and cm.state in ('active','requested')
        and not cm.muted and cm.agent_id<>new.author_agent_id
        and not public.agents_blocked(cm.agent_id,new.author_agent_id)
      on conflict do nothing;
    end if;
  else
    if tg_op='UPDATE' then
      if (new.title,new.body,new.kind,new.priority,new.expires_at,new.status)
        is not distinct from (old.title,old.body,old.kind,old.priority,old.expires_at,old.status) then return new; end if;
      update public.agent_mailbox set state='done',lease_token=null,lease_expires_at=null,
        finished_at=now(),receipt='{"status":"superseded"}' where directive_id=new.id and state<>'done';
    end if;
    if new.status='active' and (new.expires_at is null or new.expires_at>now()) then
      insert into public.agent_mailbox(agent_id,directive_id) values(new.agent_id,new.id);
    end if;
  end if;
  return new;
end $$;
create trigger chat_mail_delivery after insert or update of body,attachments,deleted_at on public.chat_messages for each row execute function public.enqueue_agent_mail();
create trigger directive_mail_delivery after insert or update on public.directives for each row execute function public.enqueue_agent_mail();

-- Existing unread mail is picked up when the feature is installed. Read messages stay read.
insert into public.agent_mailbox(agent_id,message_id)
select cm.agent_id,m.id from public.chat_messages m
join public.conversation_members cm on cm.conversation_id=m.conversation_id
where cm.state in ('active','requested') and not cm.muted and m.kind='message' and m.deleted_at is null
  and cm.agent_id<>m.author_agent_id and (cm.last_read_at is null or m.created_at>cm.last_read_at)
  and not public.agents_blocked(cm.agent_id,m.author_agent_id)
on conflict do nothing;
insert into public.agent_mailbox(agent_id,directive_id)
select agent_id,id from public.directives where status='active' and acknowledged_at is null
  and (expires_at is null or expires_at>now());

-- Check current membership, blocks, deletion, expiry and ownership at delivery time.
create function public.mailbox_letter(p_mail uuid,p_agent uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select case when q.message_id is not null then (
    select jsonb_build_object('kind','message','message',public.chat_message_json(m.id),
      'conversation',public.conversation_summary(m.conversation_id,p_agent))
    from public.chat_messages m join public.conversation_members cm on cm.conversation_id=m.conversation_id and cm.agent_id=p_agent
    where m.id=q.message_id and m.deleted_at is null and cm.state in ('active','requested') and not cm.muted
      and not public.agents_blocked(p_agent,m.author_agent_id)
  ) else (
    select jsonb_build_object('kind','directive','directive',to_jsonb(d)-'author_user_id'-'agent_id',
      'sender',jsonb_build_object('kind','owner','username',p.username))
    from public.directives d join public.agents a on a.id=d.agent_id join public.profiles p on p.id=d.author_user_id
    where d.id=q.directive_id and d.agent_id=p_agent and d.author_user_id=a.owner_id and d.status='active'
      and (d.expires_at is null or d.expires_at>now())
  ) end from public.agent_mailbox q where q.id=p_mail and q.agent_id=p_agent
$$;

create function public.agent_mailbox_list(p_agent uuid,p_limit int default 50) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('letters',coalesce(jsonb_agg(x.item order by x.sequence),'[]'::jsonb)) from (
    select q.sequence,jsonb_build_object('id',q.id,'state',q.state,'attempts',q.attempts,'available_at',q.available_at,
      'lease_expires_at',q.lease_expires_at,'created_at',q.created_at,'letter',l.letter) as item
    from public.agent_mailbox q cross join lateral (select public.mailbox_letter(q.id,p_agent) as letter) l
    where q.agent_id=p_agent and q.state<>'done' and l.letter is not null
    order by q.sequence limit least(greatest(coalesce(p_limit,50),1),100)
  ) x
$$;

create function public.agent_mailbox_claim(p_agent uuid,p_lease_seconds int default 300) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.agent_mailbox; letter jsonb;
begin
  if p_lease_seconds is null or p_lease_seconds not between 30 and 900 then raise exception 'lease_seconds must be 30-900' using errcode='PT400'; end if;
  if not exists(select 1 from public.agents where id=p_agent and status='active' and paused_at is null) then
    raise exception 'Agent is paused or inactive' using errcode='PT423'; end if;
  for q in select * from public.agent_mailbox where agent_id=p_agent and state<>'done' and available_at<=now()
    and (state='pending' or lease_expires_at<=now()) order by sequence for update skip locked limit 100
  loop
    letter:=public.mailbox_letter(q.id,p_agent);
    if letter is null then
      update public.agent_mailbox set state='done',finished_at=now(),lease_token=null,lease_expires_at=null,
        receipt='{"status":"unavailable"}' where id=q.id;
      continue;
    end if;
    update public.agent_mailbox set state='processing',attempts=attempts+1,lease_token=gen_random_uuid(),
      lease_expires_at=now()+make_interval(secs=>p_lease_seconds) where id=q.id returning * into q;
    return jsonb_build_object('delivery',jsonb_build_object('id',q.id,'lease_token',q.lease_token,
      'lease_expires_at',q.lease_expires_at,'attempts',q.attempts,'created_at',q.created_at,'letter',letter));
  end loop;
  return jsonb_build_object('delivery',null);
end $$;

create function public.agent_mailbox_update(p_agent uuid,p_mail uuid,p_token uuid,p_action text,
  p_reply text default null,p_note text default null,p_lease_seconds int default 300) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.agent_mailbox; letter jsonb; result jsonb; authz jsonb; payload jsonb;
begin
  select * into q from public.agent_mailbox where id=p_mail and agent_id=p_agent for update;
  if not found then raise exception 'Letter not found' using errcode='PT404'; end if;
  if p_token is null or q.lease_token is distinct from p_token then raise exception 'Stale delivery token' using errcode='PT409'; end if;
  -- A lost completion response can be recovered without repeating the reply.
  if q.state='done' and p_action='complete' then return q.receipt; end if;
  if q.state<>'processing' or q.lease_expires_at<=now() then raise exception 'Delivery lease expired; claim again' using errcode='PT409'; end if;
  if not exists(select 1 from public.agents where id=p_agent and status='active' and paused_at is null) then
    raise exception 'Agent is paused or inactive' using errcode='PT423'; end if;
  letter:=public.mailbox_letter(q.id,p_agent);
  if letter is null then raise exception 'Letter is no longer available' using errcode='PT409'; end if;
  if p_action='renew' then
    if p_lease_seconds is null or p_lease_seconds not between 30 and 900 then raise exception 'lease_seconds must be 30-900' using errcode='PT400'; end if;
    update public.agent_mailbox set lease_expires_at=now()+make_interval(secs=>p_lease_seconds) where id=q.id returning * into q;
    return jsonb_build_object('lease_expires_at',q.lease_expires_at);
  elsif p_action='retry' then
    update public.agent_mailbox set state='pending',lease_token=null,lease_expires_at=null,
      available_at=now()+make_interval(secs=>least(3600,30*power(2,least(q.attempts-1,7)))::int),
      last_error=left(p_note,2000) where id=q.id;
    return jsonb_build_object('status','retry_scheduled');
  elsif p_action<>'complete' then raise exception 'Unknown mailbox action' using errcode='PT400'; end if;
  if char_length(coalesce(p_note,''))>2000 then raise exception 'note must be at most 2000 characters' using errcode='PT400'; end if;
  result:=jsonb_build_object('status','completed','note',p_note);
  if p_reply is not null then
    if q.message_id is null then raise exception 'Only messages accept a reply; use note for owner directives' using errcode='PT400'; end if;
    if char_length(btrim(p_reply)) not between 1 and 8000 then raise exception 'reply must be 1-8000 characters' using errcode='PT400'; end if;
    perform public.guard_secrets(p_reply,'message');
    payload:=jsonb_build_object('conversation_id',letter->'message'->>'conversation_id','body',p_reply,'reply_to',q.message_id);
    authz:=public.authorize_standing_action(p_agent,'dm.reply',payload,'Reply to mailbox letter '||q.id);
    -- Return rather than raise so the denial audit survives the transaction.
    if authz->>'decision'='deny' then return authz||jsonb_build_object('status','denied'); end if;
    if authz->>'decision'='ask' then
      result:=authz||jsonb_build_object('status','awaiting_owner');
    else
      result:=result||jsonb_build_object('message',public.send_message(p_agent,(letter->'message'->>'conversation_id')::uuid,p_reply,q.message_id));
    end if;
  elsif q.directive_id is not null then
    -- Receipt acknowledges an instruction, never claims the requested work is done.
    result:=result||jsonb_build_object('directive',public.agent_update_directive(p_agent,q.directive_id,'ack',p_note));
  end if;
  update public.agent_mailbox set state='done',finished_at=now(),lease_expires_at=null,receipt=result,last_error=null where id=q.id;
  return result;
end $$;

revoke all on public.agent_mailbox from anon,authenticated;
revoke all on function public.enqueue_agent_mail(),public.mailbox_letter(uuid,uuid),public.agent_mailbox_list(uuid,int),
  public.agent_mailbox_claim(uuid,int),public.agent_mailbox_update(uuid,uuid,uuid,text,text,text,int) from public,anon,authenticated;
grant execute on function public.agent_mailbox_list(uuid,int),public.agent_mailbox_claim(uuid,int),
  public.agent_mailbox_update(uuid,uuid,uuid,text,text,text,int) to service_role;
notify pgrst,'reload schema';
