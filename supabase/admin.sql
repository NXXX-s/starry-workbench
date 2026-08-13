-- ============================================================
-- 管理员系统（在 SQL Editor 中运行本文件）
-- 规则：注册的第一个账号自动成为管理员；管理员可在
-- 工作台「⚙ 设置 → 账号管理」中查看/封禁/删除用户、授予管理权
-- ============================================================

-- ---------- 1. admins 表 ----------
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
-- 不开放任何直接策略：只有下方 security definer 函数能读写

-- ---------- 2. 首个注册用户自动成为管理员 ----------
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

-- ---------- 3. 管理员权限校验 ----------
create or replace function public.admin_check()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.admins a where a.user_id = auth.uid()) then
    raise exception '无管理员权限';
  end if;
end $$;

-- ---------- 4. 用户列表（仅管理员） ----------
create or replace function public.admin_list_users()
returns table (
  id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz,
  nickname text, is_admin boolean, banned_until timestamptz
) language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_check();
  if exists (select 1 from information_schema.columns
             where table_schema = 'auth' and table_name = 'users' and column_name = 'banned_until') then
    return query execute
      $q$ select u.id, u.email, u.created_at, u.last_sign_in_at,
                 coalesce(p.nickname, '创作者'),
                 exists (select 1 from public.admins a where a.user_id = u.id),
                 u.banned_until
          from auth.users u left join public.profiles p on p.id = u.id
          order by u.created_at $q$;
  else
    return query execute
      $q$ select u.id, u.email, u.created_at, u.last_sign_in_at,
                 coalesce(p.nickname, '创作者'),
                 exists (select 1 from public.admins a where a.user_id = u.id),
                 null::timestamptz as banned_until
          from auth.users u left join public.profiles p on p.id = u.id
          order by u.created_at $q$;
  end if;
end $$;

-- ---------- 5. 授予 / 取消管理员（仅管理员） ----------
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

-- ---------- 6. 封禁 / 解封（仅管理员；days<=0 为解封） ----------
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

-- ---------- 7. 删除账号（仅管理员；级联清除该用户全部数据） ----------
create or replace function public.admin_delete_user(uid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_check();
  delete from auth.users where id = uid;
end $$;

-- ---------- 8. 权限收紧：函数仅 authenticated 角色可调用 ----------
revoke all on function public.admin_list_users() from public;
revoke all on function public.admin_set_admin(uuid, boolean) from public;
revoke all on function public.admin_ban_user(uuid, int) from public;
revoke all on function public.admin_delete_user(uuid) from public;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_set_admin(uuid, boolean) to authenticated;
grant execute on function public.admin_ban_user(uuid, int) to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;
