-- Reproducible Supabase schema for Conference Deadlines.
--
-- Run this before supabase_migration.sql in a Supabase SQL Editor.
-- The public site can read conferences and deadlines. Anonymous visitors can
-- insert suggestions. Only users listed in public.admin_users can manage data.

create extension if not exists pgcrypto;

create table if not exists public.conferences (
    id text primary key,
    name text not null,
    conf_start_date date,
    conf_end_date date,
    location text,
    site_url text,
    areas jsonb not null default '{}'::jsonb,
    tags text[] not null default '{}'::text[],
    note text not null default '',
    timezone text not null default 'AOE (UTC-12)',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint conferences_areas_is_object check (jsonb_typeof(areas) = 'object')
);

create table if not exists public.deadlines (
    id bigint generated always as identity primary key,
    conference_id text not null references public.conferences(id) on delete cascade,
    deadline_type text not null default 'Deadline',
    due_date timestamptz not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.conference_suggestions (
    id uuid primary key default gen_random_uuid(),
    target_conference_id text references public.conferences(id) on delete set null,
    is_edit boolean not null default false,
    name text not null,
    site_url text not null,
    location text,
    conf_start_date date,
    conf_end_date date,
    category text,
    subfields text,
    deadlines jsonb not null default '[]'::jsonb,
    tags text[] not null default '{}'::text[],
    note text not null default '',
    created_at timestamptz not null default now(),
    constraint conference_suggestions_deadlines_is_array check (jsonb_typeof(deadlines) = 'array')
);

create table if not exists public.admin_users (
    user_id uuid primary key references auth.users(id) on delete cascade,
    email text unique,
    created_at timestamptz not null default now()
);

create index if not exists deadlines_conference_id_idx on public.deadlines(conference_id);
create index if not exists deadlines_due_date_idx on public.deadlines(due_date);
create index if not exists conference_suggestions_created_at_idx on public.conference_suggestions(created_at);
create index if not exists conference_suggestions_target_idx on public.conference_suggestions(target_conference_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists conferences_set_updated_at on public.conferences;
create trigger conferences_set_updated_at
before update on public.conferences
for each row execute function public.set_updated_at();

drop trigger if exists deadlines_set_updated_at on public.deadlines;
create trigger deadlines_set_updated_at
before update on public.deadlines
for each row execute function public.set_updated_at();

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (
        select 1
        from public.admin_users
        where user_id = auth.uid()
    );
$$;

grant usage on schema public to anon, authenticated;
grant select on public.conferences, public.deadlines to anon, authenticated;
grant insert on public.conference_suggestions to anon, authenticated;
grant select, update, delete on public.conference_suggestions to authenticated;
grant insert, update, delete on public.conferences, public.deadlines to authenticated;
grant select on public.admin_users to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.is_admin() to anon, authenticated;

alter table public.conferences enable row level security;
alter table public.deadlines enable row level security;
alter table public.conference_suggestions enable row level security;
alter table public.admin_users enable row level security;

drop policy if exists "Public can read conferences" on public.conferences;
create policy "Public can read conferences"
on public.conferences for select
using (true);

drop policy if exists "Admins can write conferences" on public.conferences;
create policy "Admins can write conferences"
on public.conferences for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Public can read deadlines" on public.deadlines;
create policy "Public can read deadlines"
on public.deadlines for select
using (true);

drop policy if exists "Admins can write deadlines" on public.deadlines;
create policy "Admins can write deadlines"
on public.deadlines for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Visitors can create suggestions" on public.conference_suggestions;
create policy "Visitors can create suggestions"
on public.conference_suggestions for insert
to anon, authenticated
with check (
    length(trim(name)) > 0
    and site_url ~* '^https?://'
    and (not is_edit or target_conference_id is not null)
);

drop policy if exists "Admins can read suggestions" on public.conference_suggestions;
create policy "Admins can read suggestions"
on public.conference_suggestions for select
to authenticated
using (public.is_admin());

drop policy if exists "Admins can update suggestions" on public.conference_suggestions;
create policy "Admins can update suggestions"
on public.conference_suggestions for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins can delete suggestions" on public.conference_suggestions;
create policy "Admins can delete suggestions"
on public.conference_suggestions for delete
to authenticated
using (public.is_admin());

drop policy if exists "Admins can read admin users" on public.admin_users;
create policy "Admins can read admin users"
on public.admin_users for select
to authenticated
using (public.is_admin());

-- Add an administrator after creating the auth user:
-- insert into public.admin_users (user_id, email)
-- select id, email from auth.users where email = 'you@example.com';
