-- Incremental, idempotent migration for annotation/reply creation and read paths.
-- Run once in the Supabase SQL Editor. It is safe to run again.

begin;

-- Keep the oldest cloud copy for each browser annotation before enforcing idempotency.
with ranked_notes as (
  select id,
         row_number() over (
           partition by author_id, local_uuid
           order by reply_count desc, upvote_count desc, updated_at desc, id asc
         ) as duplicate_number
  from public.notes
  where local_uuid is not null
)
delete from public.notes
where id in (select id from ranked_notes where duplicate_number > 1);

create unique index if not exists uq_notes_author_local_uuid
  on public.notes(author_id, local_uuid)
  where local_uuid is not null;

alter table public.note_replies
  add column if not exists client_mutation_id text;

create unique index if not exists uq_note_replies_client_mutation
  on public.note_replies(note_id, author_id, client_mutation_id)
  where client_mutation_id is not null;

create unique index if not exists uq_notifications_reply_recipient
  on public.notifications(user_id, reply_id)
  where type = 'reply' and reply_id is not null;

create index if not exists idx_notes_public_article_render
  on public.notes(article_id, cluster_key, score desc, created_at desc)
  where visibility = 'public' and status = 'active' and deleted_at is null;

create index if not exists idx_note_replies_note_render
  on public.note_replies(note_id, upvote_count desc, created_at desc)
  where status = 'active';

create index if not exists idx_notifications_user_unread
  on public.notifications(user_id, created_at desc)
  where is_read = false;

alter table public.notifications replica identity full;

do $$
declare
  realtime_table text;
begin
  foreach realtime_table in array array['notes', 'note_replies', 'notifications'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = realtime_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', realtime_table);
    end if;
  end loop;
end $$;

commit;
