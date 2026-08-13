-- ============================================================
-- 清理脚本：删除工作台的全部表/函数/触发器（用于重新初始化）
-- 在 SQL Editor 中运行本文件（可重复运行），然后运行 full-setup.sql
-- ============================================================
drop table if exists public.user_settings cascade;
drop table if exists public.news cascade;
drop table if exists public.quotes cascade;
drop table if exists public.shelf cascade;
drop table if exists public.books cascade;
drop table if exists public.requirements cascade;
drop table if exists public.components cascade;
drop table if exists public.palettes cascade;
drop table if exists public.inspirations cascade;
drop table if exists public.storyboards cascade;
drop table if exists public.assets cascade;
drop table if exists public.todos cascade;
drop table if exists public.profiles cascade;
drop function if exists public.handle_new_user() cascade;
drop trigger if exists on_auth_user_created on auth.users;
