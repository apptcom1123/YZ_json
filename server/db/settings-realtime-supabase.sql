-- Run once in the Supabase SQL Editor after deploying the matching application code.
alter table public.user_settings
  alter column save_notes_to_cloud set default false,
  alter column save_divination_to_cloud set default false,
  alter column allow_public_notes set default false,
  alter column note_visibility_threshold_percent set default 50,
  alter column notify_on_reply set default true;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notes') then
    alter publication supabase_realtime add table public.notes;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'note_replies') then
    alter publication supabase_realtime add table public.note_replies;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'note_votes') then
    alter publication supabase_realtime add table public.note_votes;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'note_favorites') then
    alter publication supabase_realtime add table public.note_favorites;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'divination_records') then
    alter publication supabase_realtime add table public.divination_records;
  end if;
end $$;
