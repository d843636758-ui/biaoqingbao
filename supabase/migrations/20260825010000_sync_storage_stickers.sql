-- Automatically mirror image objects from Storage bucket `stickers` into
-- public.sticker_catalog. Newly discovered images stay disabled until the MCP
-- has inspected the pixels and written useful Chinese metadata.

alter table public.sticker_catalog
  add column if not exists metadata_status text not null default 'ready',
  add column if not exists auto_registered boolean not null default false,
  add column if not exists metadata_updated_at timestamptz;

create index if not exists sticker_catalog_metadata_status_idx
  on public.sticker_catalog (metadata_status, created_at);

create or replace function public.sync_storage_sticker_to_catalog()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  object_name text;
  object_ext text;
  object_mime text;
  object_url text;
  generated_id text;
begin
  if tg_op = 'DELETE' then
    if old.bucket_id = 'stickers' then
      update public.sticker_catalog
      set assistant_enabled = false,
          metadata_status = 'deleted',
          metadata_updated_at = now(),
          updated_at = now()
      where storage_path = old.name;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE'
     and old.bucket_id = 'stickers'
     and (new.bucket_id <> old.bucket_id or new.name <> old.name) then
    update public.sticker_catalog
    set assistant_enabled = false,
        metadata_status = 'deleted',
        metadata_updated_at = now(),
        updated_at = now()
    where storage_path = old.name;
  end if;

  if new.bucket_id <> 'stickers' then
    return new;
  end if;

  object_name := new.name;
  object_ext := lower(substring(object_name from '\.([^.]+)$'));

  if object_ext not in ('jpg', 'jpeg', 'png', 'gif', 'webp') then
    return new;
  end if;

  object_mime := coalesce(
    nullif(new.metadata ->> 'mimetype', ''),
    case object_ext
      when 'png' then 'image/png'
      when 'gif' then 'image/gif'
      when 'webp' then 'image/webp'
      else 'image/jpeg'
    end
  );
  select
    'https://cqoevridrpdgqjyiksok.supabase.co/storage/v1/object/public/stickers/' ||
    string_agg(
      replace(replace(replace(replace(part, '%', '%25'), ' ', '%20'), '#', '%23'), '?', '%3F'),
      '/'
    )
  into object_url
  from unnest(string_to_array(object_name, '/')) as part;
  generated_id := 'st_auto_' || substring(md5(new.bucket_id || ':' || object_name), 1, 20);

  -- Preserve curated metadata when a known object is overwritten. Only a
  -- genuinely new Storage path enters the pending review queue.
  update public.sticker_catalog
  set public_url = object_url,
      filename = regexp_replace(object_name, '^.*/', ''),
      mime_type = object_mime,
      animated = object_ext = 'gif',
      updated_at = now()
  where storage_path = object_name;

  if not found then
    insert into public.sticker_catalog (
      id,
      public_url,
      filename,
      storage_path,
      mime_type,
      animated,
      ocr_text,
      visual_description,
      semantic_intent,
      tone_tags,
      use_intents,
      avoid_when,
      confidence,
      is_adult,
      assistant_enabled,
      metadata_status,
      auto_registered,
      metadata_updated_at
    ) values (
      generated_id,
      object_url,
      regexp_replace(object_name, '^.*/', ''),
      object_name,
      object_mime,
      object_ext = 'gif',
      '',
      '待识别的新上传表情包',
      '待识别',
      array['待识别'],
      array[]::text[],
      array[]::text[],
      0,
      false,
      false,
      'pending',
      true,
      null
    )
    on conflict (id) do update set
      public_url = excluded.public_url,
      filename = excluded.filename,
      storage_path = excluded.storage_path,
      mime_type = excluded.mime_type,
      animated = excluded.animated,
      updated_at = now();
  end if;

  return new;
end;
$$;

drop trigger if exists sticker_catalog_storage_insert_update on storage.objects;
create trigger sticker_catalog_storage_insert_update
after insert or update of bucket_id, name, metadata
on storage.objects
for each row
execute function public.sync_storage_sticker_to_catalog();

drop trigger if exists sticker_catalog_storage_delete on storage.objects;
create trigger sticker_catalog_storage_delete
after delete
on storage.objects
for each row
execute function public.sync_storage_sticker_to_catalog();

-- Backfill image objects that were uploaded before this trigger existed. Rows
-- already imported by the curated URL pipeline are left untouched.
insert into public.sticker_catalog (
  id,
  public_url,
  filename,
  storage_path,
  mime_type,
  animated,
  ocr_text,
  visual_description,
  semantic_intent,
  tone_tags,
  use_intents,
  avoid_when,
  confidence,
  is_adult,
  assistant_enabled,
  metadata_status,
  auto_registered
)
select
  'st_auto_' || substring(md5(o.bucket_id || ':' || o.name), 1, 20),
  'https://cqoevridrpdgqjyiksok.supabase.co/storage/v1/object/public/stickers/' ||
    (select string_agg(
      replace(replace(replace(replace(part, '%', '%25'), ' ', '%20'), '#', '%23'), '?', '%3F'),
      '/'
    ) from unnest(string_to_array(o.name, '/')) as part),
  regexp_replace(o.name, '^.*/', ''),
  o.name,
  coalesce(
    nullif(o.metadata ->> 'mimetype', ''),
    case lower(substring(o.name from '\.([^.]+)$'))
      when 'png' then 'image/png'
      when 'gif' then 'image/gif'
      when 'webp' then 'image/webp'
      else 'image/jpeg'
    end
  ),
  lower(substring(o.name from '\.([^.]+)$')) = 'gif',
  '',
  '待识别的新上传表情包',
  '待识别',
  array['待识别'],
  array[]::text[],
  array[]::text[],
  0,
  false,
  false,
  'pending',
  true
from storage.objects o
where o.bucket_id = 'stickers'
  and lower(substring(o.name from '\.([^.]+)$')) in ('jpg', 'jpeg', 'png', 'gif', 'webp')
  and not exists (
    select 1
    from public.sticker_catalog c
    where c.storage_path = o.name
  )
on conflict (id) do nothing;
