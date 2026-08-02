-- Supabase RLS hardening for the app-owned public schema.
-- Run this in the Supabase SQL Editor after configuring Supabase Auth.
--
-- The browser authenticates through Supabase Auth and public.users.id matches
-- auth.uid()::text. The server uses service_role only after it validates the
-- caller's Supabase access token and enforces resource ownership in API routes.
-- These policies protect direct PostgREST access for anon and authenticated users.

begin;

alter table public.users enable row level security;
alter table public.user_settings enable row level security;
alter table public.user_stats enable row level security;
alter table public.divination_records enable row level security;
alter table public.notes enable row level security;
alter table public.note_votes enable row level security;
alter table public.note_favorites enable row level security;
alter table public.note_replies enable row level security;
alter table public.legal_consents enable row level security;
alter table public.notifications enable row level security;
alter table public.deletion_audit_logs enable row level security;

revoke all on table public.users from anon, authenticated;
revoke all on table public.user_settings from anon, authenticated;
revoke all on table public.user_stats from anon, authenticated;
revoke all on table public.divination_records from anon, authenticated;
revoke all on table public.notes from anon, authenticated;
revoke all on table public.note_votes from anon, authenticated;
revoke all on table public.note_favorites from anon, authenticated;
revoke all on table public.note_replies from anon, authenticated;
revoke all on table public.legal_consents from anon, authenticated;
revoke all on table public.notifications from anon, authenticated;
revoke all on table public.deletion_audit_logs from anon, authenticated;

grant select on table public.users to authenticated;
grant select, update on table public.user_settings to authenticated;
grant select on table public.user_stats to authenticated;
grant select, insert, update, delete on table public.divination_records to authenticated;
grant select, insert, update, delete on table public.notes to authenticated;
grant select on table public.notes to anon;
grant select, insert, update, delete on table public.note_votes to authenticated;
grant select, insert, update, delete on table public.note_favorites to authenticated;
grant select, insert, update, delete on table public.note_replies to authenticated;
grant select on table public.note_replies to anon;
grant select on table public.legal_consents to authenticated;
grant select on table public.notifications to authenticated;
grant update (is_read, read_at) on table public.notifications to authenticated;
grant select on table public.deletion_audit_logs to authenticated;

drop policy if exists "Users can read own user row" on public.users;
drop policy if exists "Users can read public note authors" on public.users;
drop policy if exists "Users can read own settings" on public.user_settings;
drop policy if exists "Users can update own settings" on public.user_settings;
drop policy if exists "Users can read own stats" on public.user_stats;
drop policy if exists "Users can read own divinations" on public.divination_records;
drop policy if exists "Users can insert own divinations" on public.divination_records;
drop policy if exists "Users can update own divinations" on public.divination_records;
drop policy if exists "Users can delete own divinations" on public.divination_records;
drop policy if exists "Users can read visible notes" on public.notes;
drop policy if exists "Users can insert own notes" on public.notes;
drop policy if exists "Users can update own notes" on public.notes;
drop policy if exists "Users can delete own notes" on public.notes;
drop policy if exists "Users can read votes on visible notes" on public.note_votes;
drop policy if exists "Users can manage own note votes" on public.note_votes;
drop policy if exists "Users can read favorites on visible notes" on public.note_favorites;
drop policy if exists "Users can manage own favorites" on public.note_favorites;
drop policy if exists "Users can read replies on visible notes" on public.note_replies;
drop policy if exists "Users can insert own replies on visible notes" on public.note_replies;
drop policy if exists "Users can update own replies" on public.note_replies;
drop policy if exists "Users can delete own replies" on public.note_replies;
drop policy if exists "Users can read own legal consents" on public.legal_consents;
drop policy if exists "Users can read own notifications" on public.notifications;
drop policy if exists "Users can mark own notifications read" on public.notifications;
drop policy if exists "Users can read own deletion logs" on public.deletion_audit_logs;

create policy "Users can read own user row"
on public.users
for select
to authenticated
using (id = auth.uid()::text and deleted_at is null);

create policy "Users can read public note authors"
on public.users
for select
to authenticated
using (
  deleted_at is null
  and exists (
    select 1 from public.notes n
    where n.author_id = users.id
      and n.visibility = 'public'
      and n.status = 'active'
      and n.deleted_at is null
  )
);

create policy "Users can read own settings"
on public.user_settings
for select
to authenticated
using (user_id = auth.uid()::text);

create policy "Users can update own settings"
on public.user_settings
for update
to authenticated
using (user_id = auth.uid()::text)
with check (user_id = auth.uid()::text);

create policy "Users can read own stats"
on public.user_stats
for select
to authenticated
using (user_id = auth.uid()::text);

create policy "Users can read own divinations"
on public.divination_records
for select
to authenticated
using (user_id = auth.uid()::text and deleted_at is null);

create policy "Users can insert own divinations"
on public.divination_records
for insert
to authenticated
with check (user_id = auth.uid()::text);

create policy "Users can update own divinations"
on public.divination_records
for update
to authenticated
using (user_id = auth.uid()::text)
with check (user_id = auth.uid()::text);

create policy "Users can delete own divinations"
on public.divination_records
for delete
to authenticated
using (user_id = auth.uid()::text);

create policy "Users can read visible notes"
on public.notes
for select
to anon, authenticated
using (
  deleted_at is null
  and status = 'active'
  and (visibility = 'public' or author_id = auth.uid()::text)
);

create policy "Users can insert own notes"
on public.notes
for insert
to authenticated
with check (author_id = auth.uid()::text);

create policy "Users can update own notes"
on public.notes
for update
to authenticated
using (author_id = auth.uid()::text)
with check (author_id = auth.uid()::text);

create policy "Users can delete own notes"
on public.notes
for delete
to authenticated
using (author_id = auth.uid()::text);

create policy "Users can read votes on visible notes"
on public.note_votes
for select
to authenticated
using (
  user_id = auth.uid()::text
  or exists (
    select 1 from public.notes n
    where n.id = note_votes.note_id
      and n.visibility = 'public'
      and n.status = 'active'
      and n.deleted_at is null
  )
);

create policy "Users can manage own note votes"
on public.note_votes
for all
to authenticated
using (user_id = auth.uid()::text)
with check (user_id = auth.uid()::text);

create policy "Users can read favorites on visible notes"
on public.note_favorites
for select
to authenticated
using (
  user_id = auth.uid()::text
  or exists (
    select 1 from public.notes n
    where n.id = note_favorites.note_id
      and n.visibility = 'public'
      and n.status = 'active'
      and n.deleted_at is null
  )
);

create policy "Users can manage own favorites"
on public.note_favorites
for all
to authenticated
using (user_id = auth.uid()::text)
with check (user_id = auth.uid()::text);

create policy "Users can read replies on visible notes"
on public.note_replies
for select
to anon, authenticated
using (
  status = 'active'
  and (
    author_id = auth.uid()::text
    or exists (
    select 1 from public.notes n
    where n.id = note_replies.note_id
      and n.visibility = 'public'
      and n.status = 'active'
      and n.deleted_at is null
    )
  )
);

create policy "Users can insert own replies on visible notes"
on public.note_replies
for insert
to authenticated
with check (
  author_id = auth.uid()::text
  and exists (
    select 1 from public.notes n
    where n.id = note_replies.note_id
      and n.status = 'active'
      and n.deleted_at is null
      and (n.visibility = 'public' or n.author_id = auth.uid()::text)
  )
);

create policy "Users can update own replies"
on public.note_replies
for update
to authenticated
using (author_id = auth.uid()::text)
with check (author_id = auth.uid()::text);

create policy "Users can delete own replies"
on public.note_replies
for delete
to authenticated
using (author_id = auth.uid()::text);

create policy "Users can read own legal consents"
on public.legal_consents
for select
to authenticated
using (user_id = auth.uid()::text);

create policy "Users can read own notifications"
on public.notifications
for select
to authenticated
using (user_id = auth.uid()::text);

create policy "Users can mark own notifications read"
on public.notifications
for update
to authenticated
using (user_id = auth.uid()::text)
with check (user_id = auth.uid()::text);

create policy "Users can read own deletion logs"
on public.deletion_audit_logs
for select
to authenticated
using (user_id = auth.uid()::text);

commit;
