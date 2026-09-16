-- Canonical schema and non-destructive upgrade (PostgreSQL 17 / Supabase).
-- Run before publishing the frontend. Existing records and admin membership stay intact.
-- supabase_repair.sql is an identical, tested SQL Editor entry point.
begin;

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


-- Support projects created with the original dashboard schema, including UUID deadline IDs.
alter table public.conferences add column if not exists updated_at timestamptz not null default now();
alter table public.deadlines add column if not exists updated_at timestamptz not null default now();
alter table public.conference_suggestions add column if not exists areas jsonb;
alter table public.conference_suggestions add column if not exists tags text[] not null default '{}';
alter table public.conference_suggestions add column if not exists note text not null default '';

-- Older dashboard-created projects did not have this foreign key.
-- Preserve orphaned legacy suggestions while enforcing future references.
do $$ begin
    if not exists(select 1 from pg_constraint where conrelid='public.conference_suggestions'::regclass
                  and contype='f' and confrelid='public.conferences'::regclass) then
        alter table public.conference_suggestions add constraint conference_suggestions_target_conference_id_fkey
        foreign key(target_conference_id) references public.conferences(id) on delete set null not valid;
    end if;
end $$;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
    new.updated_at = now();
    return new;
end;
$$;
drop trigger if exists conferences_set_updated_at on public.conferences;
create trigger conferences_set_updated_at before update on public.conferences
for each row execute function public.set_updated_at();
drop trigger if exists deadlines_set_updated_at on public.deadlines;
create trigger deadlines_set_updated_at before update on public.deadlines
for each row execute function public.set_updated_at();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
    select exists(select 1 from public.admin_users where user_id = (select auth.uid()));
$$;

create or replace function public.valid_areas(p_areas jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb; s jsonb;
begin
    if p_areas is null or jsonb_typeof(p_areas) <> 'object' then return false; end if;
    if (select count(*) from jsonb_object_keys(p_areas)) > 32 then return false; end if;
    for k, v in select * from jsonb_each(p_areas) loop
        if length(btrim(k)) not between 1 and 100 or jsonb_typeof(v) <> 'array' then return false; end if;
        if jsonb_array_length(v) > 64 then return false; end if;
        for s in select * from jsonb_array_elements(v) loop
            if jsonb_typeof(s) <> 'string' or length(btrim(s #>> '{}')) not between 1 and 100 then return false; end if;
        end loop;
    end loop;
    return true;
end;
$$;

create or replace function public.valid_deadlines(p_deadlines jsonb)
returns boolean language plpgsql stable set search_path = '' as $$
declare d jsonb; due_value timestamptz;
begin
    if p_deadlines is null or jsonb_typeof(p_deadlines) <> 'array' then return false; end if;
    if jsonb_array_length(p_deadlines) > 64 then return false; end if;
    for d in select * from jsonb_array_elements(p_deadlines) loop
        if jsonb_typeof(d) <> 'object'
           or jsonb_typeof(d->'type') is distinct from 'string'
           or jsonb_typeof(d->'due') is distinct from 'string' then return false; end if;
        if length(btrim(d->>'type')) not between 1 and 100
           or length(d->>'due') > 40
           or (d->>'due') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,6})?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$'
        then return false; end if;
        due_value := (d->>'due')::timestamptz;
        if not isfinite(due_value) then return false; end if;
    end loop;
    return true;
exception when others then return false;
end;
$$;

create or replace function public.valid_conference_payload(p jsonb)
returns boolean language plpgsql stable set search_path = '' as $$
declare field text; first_date date; last_date date;
begin
    if p is null or jsonb_typeof(p) <> 'object'
       or jsonb_typeof(p->'name') is distinct from 'string'
       or length(btrim(p->>'name')) not between 1 and 300
       or jsonb_typeof(p->'site_url') is distinct from 'string'
       or length(p->>'site_url') > 2000
       or (p->>'site_url') !~* '^https?://[^[:space:]/]+([^[:space:]]*)$'
       or not public.valid_areas(p->'areas') then return false; end if;
    if p->>'location' is not null and
       (jsonb_typeof(p->'location') <> 'string' or length(p->>'location') > 300) then return false; end if;
    foreach field in array array['conf_start_date','conf_end_date'] loop
        if p->>field is not null then
            if jsonb_typeof(p->field) <> 'string' or (p->>field) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
            perform (p->>field)::date;
        end if;
    end loop;
    first_date := (p->>'conf_start_date')::date;
    last_date := (p->>'conf_end_date')::date;
    return first_date is null or last_date is null or last_date >= first_date;
exception when others then return false;
end;
$$;

-- Legacy suggestions describe one category; merge it into the target's other categories.
-- New clients submit a full areas object, including {} when intentionally clearing areas.
create or replace function public.suggestion_areas(p jsonb, base jsonb default '{}')
returns jsonb language sql immutable set search_path = '' as $$
    select case when p->'areas' is not null and p->'areas' <> 'null'::jsonb then p->'areas'
        when nullif(btrim(p->>'category'), '') is null then coalesce(base, '{}'::jsonb)
        else coalesce(base, '{}'::jsonb) || jsonb_build_object(btrim(p->>'category'),
            coalesce((select jsonb_agg(btrim(value)) from unnest(string_to_array(p->>'subfields', ',')) value
                      where btrim(value) <> ''), '[]'::jsonb)) end;
$$;

create or replace function public.valid_suggestion(p jsonb)
returns boolean language plpgsql stable set search_path = '' as $$
begin
    if p is null or jsonb_typeof(p) <> 'object'
       or jsonb_typeof(p->'is_edit') is distinct from 'boolean'
       or not public.valid_deadlines(p->'deadlines')
       or not public.valid_conference_payload(p || jsonb_build_object('areas', public.suggestion_areas(p)))
    then return false; end if;
    if p->>'target_conference_id' is not null and length(p->>'target_conference_id') not between 1 and 400
    then return false; end if;
    if length(coalesce(p->>'category','')) > 100 or length(coalesce(p->>'subfields','')) > 6500
       or length(coalesce(p->>'note','')) > 4000 or octet_length(p::text) > 65536 then return false; end if;
    return true;
exception when others then return false;
end;
$$;

-- Validate new payloads without rewriting legacy invalid suggestions.
-- ON DELETE SET NULL changes only the target: it must not revalidate old payloads.
alter table public.conference_suggestions drop constraint if exists suggestions_valid_payload;
create or replace function public.check_suggestion_payload()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
    if tg_op = 'UPDATE' then
        if (to_jsonb(new) - 'target_conference_id') is not distinct from (to_jsonb(old) - 'target_conference_id')
        then return new; end if;
    end if;
    if not public.valid_suggestion(to_jsonb(new)) then
        raise exception 'Invalid suggestion payload' using errcode='23514';
    end if;
    return new;
end;
$$;
drop trigger if exists suggestions_validate_payload on public.conference_suggestions;
create trigger suggestions_validate_payload before insert or update on public.conference_suggestions
for each row execute function public.check_suggestion_payload();

create or replace function public.save_conference(p_id text, p_conference jsonb, p_deadlines jsonb)
returns text language plpgsql security invoker set search_path = '' as $$
begin
    if not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
    if not public.valid_conference_payload(p_conference) or not public.valid_deadlines(p_deadlines)
    then raise exception 'Invalid conference or deadlines' using errcode='22023'; end if;
    perform id from public.conferences where id=p_id for update;
    if not found then raise exception 'Conference missing or access denied'; end if;
    update public.conferences set name=btrim(p_conference->>'name'), site_url=p_conference->>'site_url',
        location=p_conference->>'location', conf_start_date=(p_conference->>'conf_start_date')::date,
        conf_end_date=(p_conference->>'conf_end_date')::date, areas=p_conference->'areas'
    where id=p_id;
    if not found then raise exception 'Conference update affected no rows'; end if;
    delete from public.deadlines where conference_id=p_id;
    if exists(select 1 from public.deadlines where conference_id=p_id) then
        raise exception 'Deadline deletion was blocked';
    end if;
    insert into public.deadlines(conference_id,deadline_type,due_date)
    select p_id, d->>'type', (d->>'due')::timestamptz from jsonb_array_elements(p_deadlines) d;
    return p_id;
end;
$$;

create or replace function public.approve_suggestion(p_suggestion_id uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare s public.conference_suggestions; payload jsonb; target text; base jsonb; slug text; conf_year text;
begin
    if not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
    select * into s from public.conference_suggestions where id=p_suggestion_id for update;
    if not found then raise exception 'Suggestion missing or already processed'; end if;
    if not public.valid_suggestion(to_jsonb(s)) then raise exception 'Invalid suggestion; reject it and request a corrected submission' using errcode='22023'; end if;
    if s.is_edit then
        target := s.target_conference_id;
        select coalesce(areas, '{}') into base from public.conferences where id=target for update;
        if not found then raise exception 'Target conference missing; suggestion was not applied'; end if;
    else
        base := '{}';
        slug := btrim(regexp_replace(lower(s.name), '[^a-z0-9]+', '-', 'g'), '-');
        conf_year := case when extract(year from s.conf_start_date) > 1970
            then extract(year from s.conf_start_date)::text else extract(year from current_date)::text end;
        target := case when slug ~ '-[0-9]{4}$' then slug when slug='' then conf_year else slug || '-' || conf_year end;
    end if;
    payload := to_jsonb(s) || jsonb_build_object('areas', public.suggestion_areas(to_jsonb(s), base));
    if not s.is_edit then
        insert into public.conferences(id,name,tags,note)
        values(target,s.name,coalesce(s.tags,'{}'),coalesce(s.note,''));
    end if;
    perform public.save_conference(target,payload,s.deadlines);
    delete from public.conference_suggestions where id=p_suggestion_id;
    if not found then raise exception 'Suggestion cleanup was blocked'; end if;
    return target;
end;
$$;

grant usage on schema public to anon, authenticated;
revoke all on public.conferences, public.deadlines, public.conference_suggestions, public.admin_users from anon, authenticated;
grant select on public.conferences, public.deadlines to anon, authenticated;
grant insert on public.conference_suggestions to anon, authenticated;
grant insert, update, delete on public.conferences, public.deadlines to authenticated;
grant select, update, delete on public.conference_suggestions to authenticated;
grant select on public.admin_users to authenticated;
-- Only the fresh-schema identity sequence needs a grant; deployed UUID deadline IDs need none.
do $$ begin
    if pg_get_serial_sequence('public.deadlines','id') is not null then
        execute format('grant usage on sequence %s to authenticated', pg_get_serial_sequence('public.deadlines','id'));
    end if;
end $$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
revoke all on function public.set_updated_at(), public.check_suggestion_payload() from public, anon, authenticated;
revoke all on function public.save_conference(text,jsonb,jsonb), public.approve_suggestion(uuid) from public, anon;
grant execute on function public.save_conference(text,jsonb,jsonb), public.approve_suggestion(uuid) to authenticated;
revoke all on function public.valid_areas(jsonb), public.valid_deadlines(jsonb), public.valid_conference_payload(jsonb),
    public.suggestion_areas(jsonb,jsonb), public.valid_suggestion(jsonb) from public;
grant execute on function public.valid_areas(jsonb), public.valid_deadlines(jsonb), public.valid_conference_payload(jsonb),
    public.suggestion_areas(jsonb,jsonb), public.valid_suggestion(jsonb) to anon, authenticated;

alter table public.conferences enable row level security;
alter table public.deadlines enable row level security;
alter table public.conference_suggestions enable row level security;
alter table public.admin_users enable row level security;
-- Replace permissive legacy policies as part of explicitly running this repair.
do $$ declare p record;
begin
    for p in select tablename,policyname from pg_policies
             where schemaname='public' and tablename in ('conferences','deadlines','conference_suggestions','admin_users')
    loop execute format('drop policy %I on public.%I',p.policyname,p.tablename); end loop;
end $$;
create policy "Public can read conferences" on public.conferences for select to anon,authenticated using(true);
create policy "Public can read deadlines" on public.deadlines for select to anon,authenticated using(true);
create policy "Admins can insert conferences" on public.conferences for insert to authenticated with check((select public.is_admin()));
create policy "Admins can update conferences" on public.conferences for update to authenticated using((select public.is_admin())) with check((select public.is_admin()));
create policy "Admins can delete conferences" on public.conferences for delete to authenticated using((select public.is_admin()));
create policy "Admins can insert deadlines" on public.deadlines for insert to authenticated with check((select public.is_admin()));
create policy "Admins can update deadlines" on public.deadlines for update to authenticated using((select public.is_admin())) with check((select public.is_admin()));
create policy "Admins can delete deadlines" on public.deadlines for delete to authenticated using((select public.is_admin()));
-- The payload validation trigger also covers direct inserts and updates.
create policy "Visitors can create suggestions" on public.conference_suggestions for insert to anon,authenticated with check(not is_edit or target_conference_id is not null);
create policy "Admins can read suggestions" on public.conference_suggestions for select to authenticated using((select public.is_admin()));
create policy "Admins can update suggestions" on public.conference_suggestions for update to authenticated using((select public.is_admin())) with check((select public.is_admin()));
create policy "Admins can delete suggestions" on public.conference_suggestions for delete to authenticated using((select public.is_admin()));
create policy "Admins can read admin users" on public.admin_users for select to authenticated using((select public.is_admin()));

-- Never enroll every Auth user. Explicitly enroll a verified owner separately:
-- insert into public.admin_users(user_id,email)
-- select id,email from auth.users where id = 'REPLACE-WITH-VERIFIED-USER-UUID'::uuid;
notify pgrst, 'reload schema';
commit;
