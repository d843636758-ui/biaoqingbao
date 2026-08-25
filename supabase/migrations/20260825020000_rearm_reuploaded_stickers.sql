-- The first production smoke test deliberately deleted its temporary object.
-- Re-uploading the same path must put an auto-registered row back into the
-- pending queue instead of leaving it in the deleted state.

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

  update public.sticker_catalog
  set public_url = object_url,
      filename = regexp_replace(object_name, '^.*/', ''),
      mime_type = object_mime,
      animated = object_ext = 'gif',
      metadata_status = case
        when auto_registered and metadata_status = 'deleted' then 'pending'
        else metadata_status
      end,
      assistant_enabled = case
        when auto_registered and metadata_status = 'deleted' then false
        else assistant_enabled
      end,
      metadata_updated_at = case
        when auto_registered and metadata_status = 'deleted' then null
        else metadata_updated_at
      end,
      updated_at = now()
  where storage_path = object_name;

  if not found then
    insert into public.sticker_catalog (
      id, public_url, filename, storage_path, mime_type, animated,
      ocr_text, visual_description, semantic_intent, tone_tags,
      use_intents, avoid_when, confidence, is_adult, assistant_enabled,
      metadata_status, auto_registered, metadata_updated_at
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
      metadata_status = 'pending',
      assistant_enabled = false,
      metadata_updated_at = null,
      updated_at = now();
  end if;

  return new;
end;
$$;

