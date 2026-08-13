-- ============================================================
-- 星穹机甲 · 创作者工作台 — Supabase Schema
-- 在 Supabase SQL Editor 中运行本文件，然后运行 seed.sql
-- ============================================================

-- ---------- 1. profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null default '创作者',
  avatar_emoji text not null default '✨',
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

-- 注册时自动创建 profile
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------- 2. todos 待办 ----------
create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  text text not null,
  cat text not null default '剪辑',
  done boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.todos enable row level security;
create policy "todos_all" on public.todos for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- 3. assets 剪辑素材 ----------
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null,
  type text not null default '视频',           -- 视频/音频/图片/工程
  size_mb numeric(10,1) not null default 0,
  duration text default '',
  storage_path text default '',                 -- supabase storage 路径
  created_at timestamptz not null default now()
);
alter table public.assets enable row level security;
create policy "assets_all" on public.assets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- 4. storyboards 分镜脚本 ----------
create table if not exists public.storyboards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  project text not null default '未命名项目',
  shot_no int not null default 1,
  title text not null,
  scene text default '',
  lines text default '',                          -- 台词
  sfx text default '',                            -- 音效
  status text not null default '待拍摄',           -- 待拍摄/已拍摄/剪辑中
  created_at timestamptz not null default now()
);
alter table public.storyboards enable row level security;
create policy "storyboards_all" on public.storyboards for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- 5. inspirations 灵感收藏 ----------
create table if not exists public.inspirations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null,
  tag text default '灵感',
  url text default '',
  note text default '',
  created_at timestamptz not null default now()
);
alter table public.inspirations enable row level security;
create policy "inspirations_all" on public.inspirations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- 6. palettes 配色方案 ----------
create table if not exists public.palettes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null,
  colors jsonb not null default '[]'::jsonb,      -- ["#0a0a1e","#00f5ff",...]
  fonts text default '',
  usage text default '',
  created_at timestamptz not null default now()
);
alter table public.palettes enable row level security;
create policy "palettes_all" on public.palettes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- 7. components 组件库 ----------
create table if not exists public.components (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null,
  version text not null default 'v1.0',
  type text not null default 'UI组件',
  created_at timestamptz not null default now()
);
alter table public.components enable row level security;
create policy "components_all" on public.components for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- 8. requirements 需求与版本 ----------
create table if not exists public.requirements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null,
  version text not null default 'v1.0',
  note text default '',
  status text not null default '进行中',           -- 评审中/进行中/已发布/草稿
  due date,
  created_at timestamptz not null default now()
);
alter table public.requirements enable row level security;
create policy "requirements_all" on public.requirements for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- 9. shelf 我的书架 ----------
create table if not exists public.shelf (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  book_id text not null references public.books(id) on delete cascade,
  status text not null default '想读',             -- 在读/想读/读完
  progress int not null default 0,                -- 0-100
  updated_at timestamptz not null default now(),
  unique (user_id, book_id)
);
alter table public.shelf enable row level security;
create policy "shelf_all" on public.shelf for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- 10. books 书库（公共种子数据） ----------
create table if not exists public.books (
  id text primary key,
  title text not null,
  author text not null,
  emoji text default '📖',
  grad text default 'linear-gradient(135deg,#1a1a3a,#7a7ac2)',
  tag text default '推荐',
  rate int default 5,
  why text default '',
  chapters jsonb                                  -- [{t, paras:[...]}] 公版全文
);
alter table public.books enable row level security;
create policy "books_read" on public.books for select using (true);

-- ---------- 11. quotes 每日箴言（公共种子数据） ----------
create table if not exists public.quotes (
  id int primary key,
  text text not null,
  author text not null
);
alter table public.quotes enable row level security;
create policy "quotes_read" on public.quotes for select using (true);

-- ---------- 12. news 新闻情报（公共，cron 写入） ----------
create table if not exists public.news (
  id uuid primary key default gen_random_uuid(),
  category text not null,                          -- delta / ai
  title text not null,
  summary text default '',
  url text not null unique,
  source text default '',
  lang text default 'zh',                          -- zh / en
  published_at timestamptz default now(),
  created_at timestamptz not null default now()
);
create index if not exists news_cat_time_idx on public.news (category, published_at desc);
alter table public.news enable row level security;
create policy "news_read" on public.news for select using (true);

-- ---------- 13. user_settings 推送设置（微信 Server酱 / 飞书 Webhook） ----------
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  feishu_webhook text default '',
  serverchan_key text default '',
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
create policy "user_settings_select_own" on public.user_settings for select using (auth.uid() = user_id);
create policy "user_settings_insert_own" on public.user_settings for insert with check (auth.uid() = user_id);
create policy "user_settings_update_own" on public.user_settings for update using (auth.uid() = user_id);

-- 供 cron（service role）读取所有用户的推送配置：不需要额外 policy，
-- service role 默认绕过 RLS。
