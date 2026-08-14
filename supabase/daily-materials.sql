-- ============================================================
-- 每日素材库（视频 + 设计灵感）
-- 运行方式：SQL Editor 粘贴执行（幂等，可重复运行）
-- ============================================================

-- ---------- 1. 每日素材表 ----------
create table if not exists public.daily_materials (
  id uuid primary key default gen_random_uuid(),
  category text not null,              -- 'video' 视频素材 | 'design' 设计灵感
  type text not null,                  -- 子类型：自然/城市/科技/美食/旅行/人物 | 网页/APP/动效/图标/品牌/海报
  title text not null,
  url text not null unique,            -- 源链接（去重用）
  thumb text,                          -- 缩略图（已上传到本项目 Storage，国内可加载）
  source text,                         -- 来源
  created_at timestamptz not null default now(),
  expires_at timestamptz               -- 过期时间（null = 永久）
);
alter table public.daily_materials enable row level security;
create policy "mat_read" on public.daily_materials for select using (true);
create index if not exists mat_cat_type_idx on public.daily_materials (category, type, created_at desc);

-- ---------- 2. 已读记录表（每人独立） ----------
create table if not exists public.material_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid not null references public.daily_materials(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, material_id)
);
alter table public.material_reads enable row level security;
create policy "read_own" on public.material_reads for select using (auth.uid() = user_id);
create policy "insert_own" on public.material_reads for insert with check (auth.uid() = user_id);
create policy "delete_own" on public.material_reads for delete using (auth.uid() = user_id);

-- ---------- 3. 素材库支持外部链接素材 ----------
alter table public.assets add column if not exists url text;

-- ---------- 4. 保留期限配置（默认 1 天；0 = 永久） ----------
insert into public.app_config (key, value) values ('material_retention_days', '1')
  on conflict (key) do nothing;
