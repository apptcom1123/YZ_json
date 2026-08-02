-- Atomic community interactions and a minimal realtime outbox.
-- Run once in the Supabase SQL Editor after schema-supabase.sql,
-- rls-policies-supabase.sql, and annotation-performance-idempotency-supabase.sql.
-- This migration is idempotent and safe to run again.

begin;

create table if not exists public.event_outbox (
  id text primary key default gen_random_uuid()::text,
  version bigint generated always as identity unique,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  actor_user_id text not null references public.users(id) on delete cascade,
  recipient_user_id text references public.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default current_timestamp,
  processed_at timestamptz
);

create index if not exists idx_event_outbox_aggregate
  on public.event_outbox(aggregate_type, aggregate_id, version desc);
create index if not exists idx_event_outbox_recipient
  on public.event_outbox(recipient_user_id, version desc)
  where recipient_user_id is not null;
create index if not exists idx_event_outbox_unprocessed
  on public.event_outbox(version)
  where processed_at is null;

create table if not exists public.realtime_note_events (
  outbox_id text primary key references public.event_outbox(id) on delete cascade,
  version bigint not null unique,
  note_id text not null references public.notes(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default current_timestamp
);

create index if not exists idx_realtime_note_events_note
  on public.realtime_note_events(note_id, version desc);

alter table public.event_outbox enable row level security;
revoke all on table public.event_outbox from anon, authenticated;
grant select on table public.event_outbox to authenticated;

drop policy if exists "Users can read own outbox events" on public.event_outbox;
drop policy if exists "Users can read visible note activity" on public.event_outbox;

create policy "Users can read own outbox events"
on public.event_outbox for select to authenticated
using (
  actor_user_id = auth.uid()::text
  or recipient_user_id = auth.uid()::text
);

alter table public.realtime_note_events enable row level security;
revoke all on table public.realtime_note_events from anon, authenticated;
grant select on table public.realtime_note_events to anon, authenticated;
drop policy if exists "Readers can receive visible note events" on public.realtime_note_events;
create policy "Readers can receive visible note events"
on public.realtime_note_events for select to anon, authenticated
using (
  exists (
    select 1 from public.notes n
    where n.id = realtime_note_events.note_id
      and n.status = 'active'
      and n.deleted_at is null
      and (n.visibility = 'public' or n.author_id = auth.uid()::text)
  )
);

create or replace function public.project_reply_notification_from_outbox()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.aggregate_type = 'note' then
    insert into public.realtime_note_events(
      outbox_id, version, note_id, event_type, payload, created_at
    ) values (
      new.id,
      new.version,
      new.aggregate_id,
      new.event_type,
      new.payload - array['user_vote', 'is_favorited', 'notify', 'actor_name', 'deep_link'],
      new.created_at
    );
  end if;
  if new.event_type = 'reply.created'
     and new.recipient_user_id is not null
     and coalesce((new.payload ->> 'notify')::boolean, false) then
    insert into public.notifications (
      user_id, type, actor_user_id, target_type, target_id,
      note_id, reply_id, article_id, paragraph_anchor, deep_link, message
    ) values (
      new.recipient_user_id,
      'reply',
      new.actor_user_id,
      'reply',
      new.payload ->> 'reply_id',
      new.payload ->> 'note_id',
      new.payload ->> 'reply_id',
      new.payload ->> 'article_id',
      new.payload ->> 'paragraph_anchor',
      new.payload ->> 'deep_link',
      coalesce(new.payload ->> 'actor_name', '匿名使用者') || ' 回覆了你的註解'
    )
    on conflict (user_id, reply_id)
      where type = 'reply' and reply_id is not null
    do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_project_reply_notification_from_outbox on public.event_outbox;
create trigger trg_project_reply_notification_from_outbox
after insert on public.event_outbox
for each row execute function public.project_reply_notification_from_outbox();

create or replace function public.toggle_note_vote_tx(
  p_note_id text,
  p_user_id text,
  p_vote_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_note public.notes%rowtype;
  v_existing text;
  v_next_vote text;
  v_upvotes integer;
  v_downvotes integer;
  v_version bigint;
begin
  if p_vote_type not in ('up', 'down', 'none') then
    raise exception 'INVALID_VOTE_TYPE';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('note:' || p_note_id, 0));
  select * into v_note from public.notes where id = p_note_id for update;
  if not found or v_note.status <> 'active' or v_note.deleted_at is not null
     or (v_note.visibility <> 'public' and v_note.author_id <> p_user_id) then
    raise exception 'IDENTITY_VERIFICATION_FAILED';
  end if;

  select vote_type into v_existing
  from public.note_votes where note_id = p_note_id and user_id = p_user_id;
  v_next_vote := case
    when p_vote_type = 'none' or v_existing = p_vote_type then null
    else p_vote_type
  end;
  if v_next_vote is null then
    delete from public.note_votes where note_id = p_note_id and user_id = p_user_id;
  else
    insert into public.note_votes(note_id, user_id, vote_type)
    values (p_note_id, p_user_id, v_next_vote)
    on conflict (note_id, user_id) do update
      set vote_type = excluded.vote_type, updated_at = current_timestamp;
  end if;

  select count(*) filter (where vote_type = 'up'),
         count(*) filter (where vote_type = 'down')
  into v_upvotes, v_downvotes
  from public.note_votes where note_id = p_note_id;
  update public.notes set
    upvote_count = v_upvotes,
    downvote_count = v_downvotes,
    score = v_upvotes - v_downvotes,
    updated_at = current_timestamp
  where id = p_note_id;

  insert into public.event_outbox(
    event_type, aggregate_type, aggregate_id, actor_user_id, recipient_user_id, payload
  ) values (
    'note.vote.updated', 'note', p_note_id, p_user_id,
    case when v_note.author_id <> p_user_id then v_note.author_id else null end,
    jsonb_build_object(
      'note_id', p_note_id, 'user_vote', v_next_vote,
      'upvote_count', v_upvotes, 'downvote_count', v_downvotes,
      'score', v_upvotes - v_downvotes
    )
  ) returning version into v_version;

  return jsonb_build_object(
    'success', true,
    'userVote', v_next_vote,
    'version', v_version,
    'note', jsonb_build_object(
      'id', p_note_id, 'upvote_count', v_upvotes,
      'downvote_count', v_downvotes, 'score', v_upvotes - v_downvotes
    )
  );
end;
$$;

create or replace function public.toggle_note_favorite_tx(
  p_note_id text,
  p_user_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_note public.notes%rowtype;
  v_is_favorited boolean;
  v_count integer;
  v_version bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('note:' || p_note_id, 0));
  select * into v_note from public.notes where id = p_note_id for update;
  if not found or v_note.status <> 'active' or v_note.deleted_at is not null
     or (v_note.visibility <> 'public' and v_note.author_id <> p_user_id) then
    raise exception 'IDENTITY_VERIFICATION_FAILED';
  end if;

  if exists(select 1 from public.note_favorites where note_id = p_note_id and user_id = p_user_id) then
    delete from public.note_favorites where note_id = p_note_id and user_id = p_user_id;
    v_is_favorited := false;
  else
    insert into public.note_favorites(note_id, user_id) values (p_note_id, p_user_id);
    v_is_favorited := true;
  end if;
  select count(*) into v_count from public.note_favorites where note_id = p_note_id;
  update public.notes set favorite_count = v_count, updated_at = current_timestamp where id = p_note_id;

  insert into public.event_outbox(
    event_type, aggregate_type, aggregate_id, actor_user_id, recipient_user_id, payload
  ) values (
    'note.favorite.updated', 'note', p_note_id, p_user_id,
    case when v_note.author_id <> p_user_id then v_note.author_id else null end,
    jsonb_build_object(
      'note_id', p_note_id, 'is_favorited', v_is_favorited, 'favorite_count', v_count
    )
  ) returning version into v_version;

  return jsonb_build_object(
    'success', true,
    'isFavorited', v_is_favorited,
    'version', v_version,
    'note', jsonb_build_object('id', p_note_id, 'favorite_count', v_count)
  );
end;
$$;

create or replace function public.toggle_reply_vote_tx(
  p_note_id text,
  p_reply_id text,
  p_user_id text,
  p_vote_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_note public.notes%rowtype;
  v_reply public.note_replies%rowtype;
  v_existing text;
  v_next_vote text;
  v_upvotes integer;
  v_downvotes integer;
  v_version bigint;
begin
  if p_vote_type not in ('up', 'down', 'none') then raise exception 'INVALID_VOTE_TYPE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('reply:' || p_reply_id, 0));
  select * into v_note from public.notes where id = p_note_id;
  select * into v_reply from public.note_replies where id = p_reply_id for update;
  if v_note.id is null or v_reply.id is null or v_reply.note_id <> p_note_id
     or v_reply.status <> 'active' or v_note.status <> 'active' or v_note.deleted_at is not null
     or (v_note.visibility <> 'public' and v_note.author_id <> p_user_id) then
    raise exception 'IDENTITY_VERIFICATION_FAILED';
  end if;

  select vote_type into v_existing
  from public.reply_votes where reply_id = p_reply_id and user_id = p_user_id;
  v_next_vote := case
    when p_vote_type = 'none' or v_existing = p_vote_type then null
    else p_vote_type
  end;
  if v_next_vote is null then
    delete from public.reply_votes where reply_id = p_reply_id and user_id = p_user_id;
  else
    insert into public.reply_votes(reply_id, user_id, vote_type)
    values (p_reply_id, p_user_id, v_next_vote)
    on conflict (reply_id, user_id) do update
      set vote_type = excluded.vote_type, updated_at = current_timestamp;
  end if;

  select count(*) filter (where vote_type = 'up'),
         count(*) filter (where vote_type = 'down')
  into v_upvotes, v_downvotes
  from public.reply_votes where reply_id = p_reply_id;
  update public.note_replies set
    upvote_count = v_upvotes,
    downvote_count = v_downvotes,
    updated_at = current_timestamp
  where id = p_reply_id;

  insert into public.event_outbox(
    event_type, aggregate_type, aggregate_id, actor_user_id, recipient_user_id, payload
  ) values (
    'reply.vote.updated', 'note', p_note_id, p_user_id,
    case when v_reply.author_id <> p_user_id then v_reply.author_id else null end,
    jsonb_build_object(
      'note_id', p_note_id, 'reply_id', p_reply_id, 'user_vote', v_next_vote,
      'upvote_count', v_upvotes, 'downvote_count', v_downvotes
    )
  ) returning version into v_version;

  return jsonb_build_object(
    'success', true,
    'userVote', v_next_vote,
    'version', v_version,
    'reply', jsonb_build_object(
      'id', p_reply_id, 'note_id', p_note_id,
      'upvote_count', v_upvotes, 'downvote_count', v_downvotes
    )
  );
end;
$$;

create or replace function public.create_note_reply_tx(
  p_note_id text,
  p_user_id text,
  p_content text,
  p_parent_reply_id text default null,
  p_client_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_note public.notes%rowtype;
  v_reply public.note_replies%rowtype;
  v_actor_name text;
  v_notify boolean := false;
  v_reply_count integer;
  v_version bigint;
begin
  if nullif(trim(p_content), '') is null then raise exception 'MISSING_CONTENT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('note:' || p_note_id, 0));
  select * into v_note from public.notes where id = p_note_id for update;
  if not found or v_note.status <> 'active' or v_note.deleted_at is not null
     or (v_note.visibility <> 'public' and v_note.author_id <> p_user_id) then
    raise exception 'IDENTITY_VERIFICATION_FAILED';
  end if;
  if p_parent_reply_id is not null and not exists(
    select 1 from public.note_replies
    where id = p_parent_reply_id and note_id = p_note_id and status = 'active'
  ) then
    raise exception 'PARENT_REPLY_NOT_FOUND';
  end if;

  if p_client_request_id is not null then
    select * into v_reply from public.note_replies
    where note_id = p_note_id and author_id = p_user_id
      and client_mutation_id = p_client_request_id;
    if found then
      select public_display_name into v_actor_name from public.users where id = p_user_id;
      return jsonb_build_object(
        'success', true, 'idempotent', true, 'version', null,
        'reply', to_jsonb(v_reply) || jsonb_build_object('public_display_name', v_actor_name)
      );
    end if;
  end if;

  insert into public.note_replies(
    note_id, parent_reply_id, author_id, content, client_mutation_id, status
  ) values (
    p_note_id, p_parent_reply_id, p_user_id, trim(p_content), p_client_request_id, 'active'
  ) returning * into v_reply;

  select count(*) into v_reply_count
  from public.note_replies where note_id = p_note_id and status = 'active';
  update public.notes set reply_count = v_reply_count, updated_at = current_timestamp where id = p_note_id;
  if p_parent_reply_id is not null then
    update public.note_replies set updated_at = current_timestamp where id = p_parent_reply_id;
  end if;

  select public_display_name into v_actor_name from public.users where id = p_user_id;
  if v_note.visibility = 'public' and v_note.author_id <> p_user_id then
    select coalesce((
      select notify_on_reply from public.user_settings where user_id = v_note.author_id
    ), true) into v_notify;
  end if;

  insert into public.event_outbox(
    event_type, aggregate_type, aggregate_id, actor_user_id, recipient_user_id, payload
  ) values (
    'reply.created', 'note', p_note_id, p_user_id,
    case when v_note.author_id <> p_user_id then v_note.author_id else null end,
    jsonb_build_object(
      'reply_id', v_reply.id,
      'note_id', p_note_id,
      'article_id', v_note.article_id,
      'paragraph_anchor', v_note.paragraph_anchor,
      'reply_count', v_reply_count,
      'actor_name', coalesce(v_actor_name, '匿名使用者'),
      'notify', v_notify,
      'deep_link', '/#' || v_note.article_id || '?note_id=' || p_note_id || '&reply_id=' || v_reply.id
    )
  ) returning version into v_version;

  return jsonb_build_object(
    'success', true,
    'idempotent', false,
    'version', v_version,
    'reply', to_jsonb(v_reply) || jsonb_build_object('public_display_name', v_actor_name)
  );
end;
$$;

revoke all on function public.toggle_note_vote_tx(text,text,text) from public, anon, authenticated;
revoke all on function public.toggle_note_favorite_tx(text,text) from public, anon, authenticated;
revoke all on function public.toggle_reply_vote_tx(text,text,text,text) from public, anon, authenticated;
revoke all on function public.create_note_reply_tx(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.toggle_note_vote_tx(text,text,text) to service_role;
grant execute on function public.toggle_note_favorite_tx(text,text) to service_role;
grant execute on function public.toggle_reply_vote_tx(text,text,text,text) to service_role;
grant execute on function public.create_note_reply_tx(text,text,text,text,text) to service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'realtime_note_events'
  ) then
    alter publication supabase_realtime add table public.realtime_note_events;
  end if;
end $$;

commit;
