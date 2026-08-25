-- sticker_catalog.sql
-- 项目 cqoevridrpdgqjyiksok 的可直接执行版。
-- 可重复执行：表、索引、RLS policy 与控制组记录都会安全地创建/更新。

create table if not exists public.sticker_catalog (
  id text primary key,
  public_url text not null,
  filename text,
  storage_path text,
  mime_type text not null default 'image/jpeg',
  animated boolean not null default false,

  ocr_text text not null default '',
  visual_description text not null default '',
  semantic_intent text not null default '',

  tone_tags text[] not null default '{}',
  use_intents text[] not null default '{}',
  avoid_when text[] not null default '{}',

  confidence numeric not null default 1.0,
  is_adult boolean not null default false,
  assistant_enabled boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sticker_catalog_enabled_idx
  on public.sticker_catalog (assistant_enabled);

create index if not exists sticker_catalog_tone_tags_gin
  on public.sticker_catalog using gin (tone_tags);

create index if not exists sticker_catalog_use_intents_gin
  on public.sticker_catalog using gin (use_intents);

alter table public.sticker_catalog enable row level security;

drop policy if exists "public can read enabled stickers" on public.sticker_catalog;

create policy "public can read enabled stickers"
on public.sticker_catalog
for select
to anon, authenticated
using (assistant_enabled = true);

-- 控制组图片已经位于 Storage -> stickers -> funny/control.png。
-- 当前先使用中性测试元数据；确认画面内容后再补成真实语义。
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
  assistant_enabled
)
values (
  'st_control_001',
  'https://cqoevridrpdgqjyiksok.supabase.co/storage/v1/object/public/stickers/funny/control.png',
  'control.png',
  'funny/control.png',
  'image/png',
  false,
  '',
  '控制组测试图片 control.png，用于验证 Storage 公网访问与 MCP 图片渲染链路',
  '链路测试与占位控制组，不代表特定聊天情绪',
  array['测试', '中性'],
  array['验证 search_stickers 与 send_sticker 是否能正常返回并显示图片'],
  array['正式投入聊天前，请先补全这张图的真实语义与使用边界'],
  1.0,
  false,
  true
)
on conflict (id) do update set
  public_url = excluded.public_url,
  filename = excluded.filename,
  storage_path = excluded.storage_path,
  mime_type = excluded.mime_type,
  animated = excluded.animated,
  ocr_text = excluded.ocr_text,
  visual_description = excluded.visual_description,
  semantic_intent = excluded.semantic_intent,
  tone_tags = excluded.tone_tags,
  use_intents = excluded.use_intents,
  avoid_when = excluded.avoid_when,
  confidence = excluded.confidence,
  is_adult = excluded.is_adult,
  assistant_enabled = excluded.assistant_enabled,
  updated_at = now();
