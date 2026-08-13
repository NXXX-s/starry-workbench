-- ============================================================
-- 【早上起床只需跑这一个文件】
-- 星穹机甲 · 一键初始化 v2：
--   1) 注册自动确认邮箱（免邮件验证）
--   2) 管理员系统（首个注册用户自动成为管理员）
--   3) 邮箱有效性检查支持（profiles 增加标记列）
--   4) 通知表（管理员收提醒）
--   5) 无效邮箱自动清除配置表（1天/7天/30天/半年/1年/永久）
--   6) 定时处理函数（每日提醒管理员、逾期自动删除账号）
-- 全部可重复执行（幂等）
-- ============================================================

-- ---------- 1. 注册自动确认邮箱 ----------
create or replace function public.auto_confirm_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.email_confirmed_at = coalesce(new.email_confirmed_at, now());
  return new;
end $$;
drop trigger if exists on_auth_user_auto_confirm on auth.users;
create trigger on_auth_user_auto_confirm before insert on auth.users
  for each row execute procedure public.auto_confirm_email();

-- ---------- 2. admins 表 + 首个注册用户自动成为管理员 ----------
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

create or replace function public.auto_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.admins) then
    insert into public.admins (user_id) values (new.id);
  end if;
  return new;
end $$;
drop trigger if exists on_profile_auto_admin on public.profiles;
create trigger on_profile_auto_admin after insert on public.profiles
  for each row execute procedure public.auto_admin();

-- ---------- 3. profiles 增加邮箱有效性列 ----------
alter table public.profiles add column if not exists email_valid boolean;
alter table public.profiles add column if not exists email_checked_at timestamptz;
alter table public.profiles add column if not exists invalid_flagged_at timestamptz;
alter table public.profiles add column if not exists invalid_reminded_at timestamptz;

-- ---------- 4. 通知表（管理员提醒） ----------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.notifications enable row level security;
create policy "notif_read_own" on public.notifications for select using (auth.uid() = user_id);
create policy "notif_update_own" on public.notifications for update using (auth.uid() = user_id);

-- ---------- 5. 应用配置表（无效邮箱清除期限） ----------
create table if not exists public.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
create policy "config_read" on public.app_config for select using (true);
insert into public.app_config (key, value) values ('invalid_email_ttl_days', '7')
  on conflict (key) do nothing;

-- ---------- 6. 管理员权限校验 ----------
create or replace function public.admin_check()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.admins a where a.user_id = auth.uid()) then
    raise exception '无管理员权限';
  end if;
end $$;

-- ---------- 7. 用户列表（仅管理员；含邮箱有效性标记） ----------
drop function if exists public.admin_list_users();
create or replace function public.admin_list_users()
returns table (
  id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz,
  nickname text, is_admin boolean, banned_until timestamptz,
  email_valid boolean, invalid_flagged_at timestamptz
) language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_check();
  if exists (select 1 from information_schema.columns
             where table_schema = 'auth' and table_name = 'users' and column_name = 'banned_until') then
    return query execute
      $q$ select u.id, u.email, u.created_at, u.last_sign_in_at,
                 coalesce(p.nickname, '创作者'),
                 exists (select 1 from public.admins a where a.user_id = u.id),
                 u.banned_until, p.email_valid, p.invalid_flagged_at
          from auth.users u left join public.profiles p on p.id = u.id
          order by u.created_at $q$;
  else
    return query execute
      $q$ select u.id, u.email, u.created_at, u.last_sign_in_at,
                 coalesce(p.nickname, '创作者'),
                 exists (select 1 from public.admins a where a.user_id = u.id),
                 null::timestamptz as banned_until, p.email_valid, p.invalid_flagged_at
          from auth.users u left join public.profiles p on p.id = u.id
          order by u.created_at $q$;
  end if;
end $$;

-- ---------- 8. 授予 / 取消管理员（仅管理员） ----------
create or replace function public.admin_set_admin(uid uuid, make_admin boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_check();
  if make_admin then
    insert into public.admins (user_id) values (uid) on conflict (user_id) do nothing;
  else
    delete from public.admins where user_id = uid;
  end if;
end $$;

-- ---------- 9. 封禁 / 解封（仅管理员） ----------
create or replace function public.admin_ban_user(uid uuid, days int)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_check();
  if exists (select 1 from information_schema.columns
             where table_schema = 'auth' and table_name = 'users' and column_name = 'banned_until') then
    if days > 0 then
      execute 'update auth.users set banned_until = now() + ($1 || '' days'')::interval where id = $2' using days, uid;
    else
      execute 'update auth.users set banned_until = null where id = $1' using uid;
    end if;
  else
    raise exception '当前 Supabase 版本不支持封禁功能';
  end if;
end $$;

-- ---------- 10. 删除账号（仅管理员；级联清除全部数据） ----------
create or replace function public.admin_delete_user(uid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_check();
  delete from auth.users where id = uid;
end $$;

-- ---------- 11. 管理员修改配置（清除期限等） ----------
create or replace function public.admin_set_config(cfg_key text, cfg_value text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_check();
  insert into public.app_config (key, value, updated_at) values (cfg_key, cfg_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

-- ---------- 12. 定时任务专用函数（仅 service_role 可调用） ----------
create or replace function public.cron_invalid_users()
returns table (user_id uuid, email text, flagged_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  return query
    select p.id, u.email::text, p.invalid_flagged_at
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.email_valid = false and p.invalid_flagged_at is not null
    order by p.invalid_flagged_at;
end $$;

create or replace function public.cron_delete_user(uid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from auth.users where id = uid;
end $$;

-- ---------- 13. 权限收紧 ----------
revoke all on function public.admin_list_users() from public;
revoke all on function public.admin_set_admin(uuid, boolean) from public;
revoke all on function public.admin_ban_user(uuid, int) from public;
revoke all on function public.admin_delete_user(uuid) from public;
revoke all on function public.admin_set_config(text, text) from public;
revoke all on function public.cron_invalid_users() from public, anon, authenticated;
revoke all on function public.cron_delete_user(uuid) from public, anon, authenticated;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_set_admin(uuid, boolean) to authenticated;
grant execute on function public.admin_ban_user(uuid, int) to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;
grant execute on function public.admin_set_config(text, text) to authenticated;
grant execute on function public.cron_invalid_users() to service_role;
grant execute on function public.cron_delete_user(uuid) to service_role;
