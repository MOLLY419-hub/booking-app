-- Multi-camp support for the internal booking app.
-- Safe to run once in Supabase SQL Editor. Existing data is preserved and assigned to 燈火嵐杉.

create extension if not exists "pgcrypto";

create table if not exists public.camps (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.camps (name)
values ('燈火嵐杉'), ('秋慕嵐杉')
on conflict (name) do nothing;

alter table public.rooms
add column if not exists camp_id uuid references public.camps(id);

alter table public.booking_orders
add column if not exists camp_id uuid references public.camps(id);

alter table public.price_calendar
add column if not exists camp_id uuid references public.camps(id);

update public.rooms
set camp_id = (select id from public.camps where name = '燈火嵐杉')
where camp_id is null;

update public.booking_orders
set camp_id = (select id from public.camps where name = '燈火嵐杉')
where camp_id is null;

update public.price_calendar
set camp_id = (select id from public.camps where name = '燈火嵐杉')
where camp_id is null;

alter table public.price_calendar
alter column camp_id set not null;

do $$
declare
  pk_name text;
begin
  select conname into pk_name
  from pg_constraint
  where conrelid = 'public.price_calendar'::regclass
    and contype = 'p';

  if pk_name is not null then
    execute format('alter table public.price_calendar drop constraint %I', pk_name);
  end if;
end $$;

alter table public.price_calendar
add primary key (camp_id, date);

create index if not exists rooms_camp_id_idx on public.rooms(camp_id);
create index if not exists booking_orders_camp_id_idx on public.booking_orders(camp_id);
create index if not exists price_calendar_camp_id_idx on public.price_calendar(camp_id);

alter table public.camps enable row level security;

drop policy if exists "camps_select_authenticated" on public.camps;
create policy "camps_select_authenticated"
on public.camps
for select
to authenticated
using (true);

drop policy if exists "camps_write_admin_staff" on public.camps;
create policy "camps_write_admin_staff"
on public.camps
for all
to authenticated
using (public.current_user_role() in ('admin', 'staff'))
with check (public.current_user_role() in ('admin', 'staff'));
