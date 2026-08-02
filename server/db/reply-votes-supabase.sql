-- Run once in the Supabase SQL Editor after settings-realtime-supabase.sql.
-- Adds authenticated, owner-bound reply votes used by the discussion "Best" sort.

begin;

create table if not exists public.reply_votes (
  reply_id text not null references public.note_replies(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  vote_type text not null check (vote_type in ('up', 'down')),
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp,
  primary key (reply_id, user_id)
);

create index if not exists idx_reply_votes_reply on public.reply_votes(reply_id);

alter table public.reply_votes enable row level security;
revoke all on table public.reply_votes from anon, authenticated;
grant select, insert, update, delete on table public.reply_votes to authenticated;

drop policy if exists "Users can read votes on visible replies" on public.reply_votes;
drop policy if exists "Users can manage own reply votes" on public.reply_votes;

create policy "Users can read votes on visible replies"
on public.reply_votes
for select
to authenticated
using (
  exists (
    select 1
    from public.note_replies r
    join public.notes n on n.id = r.note_id
    where r.id = reply_votes.reply_id
      and r.status = 'active'
      and n.visibility = 'public'
      and n.status = 'active'
      and n.deleted_at is null
  )
);

create policy "Users can manage own reply votes"
on public.reply_votes
for all
to authenticated
using (user_id = auth.uid()::text)
with check (user_id = auth.uid()::text);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'reply_votes'
  ) then
    alter publication supabase_realtime add table public.reply_votes;
  end if;
end $$;

commit;
