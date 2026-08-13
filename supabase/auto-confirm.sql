-- ============================================================
-- 注册即自动确认邮箱（免邮件确认）
-- 效果：新用户注册后无需点击确认邮件，直接可以登录
-- 撤销：执行  drop trigger if exists on_auth_user_auto_confirm on auth.users;
-- ============================================================

create or replace function public.auto_confirm_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.email_confirmed_at = coalesce(new.email_confirmed_at, now());
  return new;
end $$;

drop trigger if exists on_auth_user_auto_confirm on auth.users;
create trigger on_auth_user_auto_confirm before insert on auth.users
  for each row execute procedure public.auto_confirm_email();
