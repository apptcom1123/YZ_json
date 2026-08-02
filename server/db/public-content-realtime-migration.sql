-- Incremental migration for public annotations and Supabase Realtime.
-- Safe to run more than once in the Supabase SQL Editor.

begin;

alter table public.user_settings
  alter column save_notes_to_cloud set default false,
  alter column save_divination_to_cloud set default false,
  alter column allow_public_notes set default false,
  alter column note_visibility_threshold_percent set default 50,
  alter column notify_on_reply set default true;

alter table public.notes enable row level security;
alter table public.note_replies enable row level security;
grant select on table public.notes to anon, authenticated;
grant select on table public.note_replies to anon, authenticated;

drop policy if exists "Users can read visible notes" on public.notes;
create policy "Users can read visible notes"
on public.notes
for select
to anon, authenticated
using (
  deleted_at is null
  and status = 'active'
  and (visibility = 'public' or author_id = auth.uid()::text)
);

drop policy if exists "Users can read replies on visible notes" on public.note_replies;
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

alter table public.notes replica identity full;
alter table public.note_replies replica identity full;

do $$
declare
  realtime_table text;
begin
  foreach realtime_table in array array[
    'notes', 'note_replies', 'note_votes', 'note_favorites',
    'reply_votes', 'notifications', 'divination_records'
  ] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = realtime_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', realtime_table);
    end if;
  end loop;
end $$;

commit;
