-- Repairs a Supabase project whose tables were created by hand and have since
-- drifted from supabase_schema.sql. Run it once in the Supabase SQL Editor.
--
-- Why this exists: on the deployed database, deleting a conference from the
-- admin page silently did nothing. Row-level security was enabled on
-- public.conferences without a policy covering DELETE, so PostgREST reported
-- success while removing zero rows. The same gap is repaired for updates and
-- for the suggestions table.
--
-- Safe to re-run. It never drops a table and never deletes a row. It DOES drop
-- and recreate every policy on the four tables below, replacing whatever is
-- there with the model documented in supabase_schema.sql: the public reads
-- conferences and deadlines, visitors may only insert suggestions, and only
-- users listed in public.admin_users may write.

begin;

-- ---------------------------------------------------------------------------
-- 1. Admin model. The deployed database has no admin_users table, so every
--    signed-in user is currently as privileged as the owner.
-- ---------------------------------------------------------------------------

create table if not exists public.admin_users (
    user_id uuid primary key references auth.users(id) on delete cascade,
    email text unique,
    created_at timestamptz not null default now()
);

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

-- Promote the accounts that already exist. This project has a single owner, so
-- adopting every current auth user is the safe default: skipping this step
-- would lock the admin page out of writes entirely once the policies below
-- start requiring is_admin(). To adopt one specific account instead, replace
-- the WHERE clause with:  where email = 'you@example.com'
insert into public.admin_users (user_id, email)
select id, email
from auth.users
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Columns the schema file assumes. conferences/deadlines were created
--    without updated_at, so the set_updated_at triggers below would fail at
--    runtime without this. Adding the column is additive and keeps data.
-- ---------------------------------------------------------------------------

alter table public.conferences add column if not exists updated_at timestamptz not null default now();
alter table public.deadlines   add column if not exists updated_at timestamptz not null default now();

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

-- ---------------------------------------------------------------------------
-- 3. Table privileges. The anon role currently holds write privileges it does
--    not need; only row-level security stands between the public anon key and
--    a mass delete. Narrow anon down to exactly what the site does.
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated;

revoke all on public.conferences, public.deadlines, public.conference_suggestions from anon;
grant select on public.conferences, public.deadlines to anon;
grant insert on public.conference_suggestions to anon;

grant select, insert, update, delete on public.conferences, public.deadlines to authenticated;
grant select, insert, update, delete on public.conference_suggestions to authenticated;
grant select on public.admin_users to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Policies. Clear whatever accumulated by hand, then recreate the canonical
--    set. "for all" is what covers DELETE — the clause that was missing.
-- ---------------------------------------------------------------------------

alter table public.conferences enable row level security;
alter table public.deadlines enable row level security;
alter table public.conference_suggestions enable row level security;
alter table public.admin_users enable row level security;

do $$
declare
    pol record;
begin
    for pol in
        select schemaname, tablename, policyname
        from pg_policies
        where schemaname = 'public'
          and tablename in ('conferences', 'deadlines', 'conference_suggestions', 'admin_users')
    loop
        execute format('drop policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
    end loop;
end $$;

create policy "Public can read conferences"
on public.conferences for select
using (true);

create policy "Admins can write conferences"
on public.conferences for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Public can read deadlines"
on public.deadlines for select
using (true);

create policy "Admins can write deadlines"
on public.deadlines for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Visitors can create suggestions"
on public.conference_suggestions for insert
to anon, authenticated
with check (
    length(trim(name)) > 0
    and site_url ~* '^https?://'
    and (not is_edit or target_conference_id is not null)
);

create policy "Admins can read suggestions"
on public.conference_suggestions for select
to authenticated
using (public.is_admin());

create policy "Admins can update suggestions"
on public.conference_suggestions for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Admins can delete suggestions"
on public.conference_suggestions for delete
to authenticated
using (public.is_admin());

create policy "Admins can read admin users"
on public.admin_users for select
to authenticated
using (public.is_admin());

commit;

-- ---------------------------------------------------------------------------
-- 5. Verification. Expect at least one admin row, and a "for all" (ALL) policy
--    on conferences and deadlines.
-- ---------------------------------------------------------------------------

select 'admins registered' as check, count(*)::text as value from public.admin_users
union all
select 'conferences rows', count(*)::text from public.conferences;

select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in ('conferences', 'deadlines', 'conference_suggestions', 'admin_users')
order by tablename, policyname;
