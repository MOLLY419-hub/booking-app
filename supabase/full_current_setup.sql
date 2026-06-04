-- Complete current setup for the internal booking management app.
-- Safe to run on the existing Supabase project.
-- It preserves auth.users and profiles, promotes wutyimor@gmail.com to admin,
-- creates/upgrades tables, policies, real rooms, multi-room orders, and date-based prices.

create extension if not exists "pgcrypto";

do $$
begin
  create type public.app_role as enum ('admin', 'staff', 'viewer');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.booking_status as enum (
    'pending',
    'awaiting_deposit_confirmation',
    'confirmed',
    'checked_in',
    'checked_out',
    'cancelled'
  );
exception
  when duplicate_object then null;
end $$;

alter type public.booking_status
add value if not exists 'awaiting_deposit_confirmation';

do $$
begin
  create type public.rate_category as enum (
    'weekday',
    'friday_sunday_holiday',
    'saturday',
    'consecutive_holiday'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role public.app_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  room_type text,
  capacity integer not null default 1 check (capacity > 0),
  base_price numeric(10, 2) not null default 0 check (base_price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.rooms
add column if not exists base_price numeric(10, 2) not null default 0 check (base_price >= 0);

create table if not exists public.booking_orders (
  id uuid primary key default gen_random_uuid(),
  guest_name text not null,
  guest_phone text,
  company_contact text,
  check_in_date date not null,
  check_out_date date not null,
  room_count integer not null default 1 check (room_count > 0),
  total_amount numeric(10, 2) not null default 0 check (total_amount >= 0),
  deposit_amount numeric(10, 2) not null default 0 check (deposit_amount >= 0),
  balance_amount numeric(10, 2) not null default 0 check (balance_amount >= 0),
  deposit_payment_last5 text check (deposit_payment_last5 is null or deposit_payment_last5 ~ '^[0-9]{5}$'),
  deposit_confirmed boolean not null default false,
  deposit_confirmed_at timestamptz,
  status public.booking_status not null default 'pending',
  note text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_order_dates check (check_out_date > check_in_date)
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.booking_orders(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete restrict,
  guest_name text not null,
  guest_phone text,
  company_contact text,
  check_in_date date not null,
  check_out_date date not null,
  room_price numeric(10, 2) not null default 0 check (room_price >= 0),
  status public.booking_status not null default 'confirmed',
  note text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_booking_dates check (check_out_date >= check_in_date)
);

alter table public.bookings
add column if not exists order_id uuid references public.booking_orders(id) on delete cascade;

alter table public.bookings
add column if not exists room_price numeric(10, 2) not null default 0 check (room_price >= 0);

alter table public.booking_orders
add column if not exists deposit_confirmed boolean not null default false;

alter table public.booking_orders
add column if not exists deposit_confirmed_at timestamptz;

alter table public.booking_orders
alter column status set default 'pending';

alter table public.bookings
alter column status set default 'pending';

create table if not exists public.price_rules (
  id uuid primary key default gen_random_uuid(),
  room_type text not null,
  rate_category public.rate_category not null,
  price numeric(10, 2) not null check (price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_type, rate_category)
);

create table if not exists public.price_calendar (
  date date primary key,
  rate_category public.rate_category not null,
  label text,
  custom_prices jsonb,
  created_at timestamptz not null default now()
);

alter table public.price_calendar
add column if not exists custom_prices jsonb;

create index if not exists bookings_room_date_idx
  on public.bookings (room_id, check_in_date, check_out_date);

create index if not exists bookings_status_idx
  on public.bookings (status);

create index if not exists booking_orders_date_idx
  on public.booking_orders (check_in_date, check_out_date);

create index if not exists bookings_order_id_idx
  on public.bookings (order_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_bookings_updated_at on public.bookings;
create trigger set_bookings_updated_at
before update on public.bookings
for each row execute function public.set_updated_at();

drop trigger if exists set_booking_orders_updated_at on public.booking_orders;
create trigger set_booking_orders_updated_at
before update on public.booking_orders
for each row execute function public.set_updated_at();

drop trigger if exists set_price_rules_updated_at on public.price_rules;
create trigger set_price_rules_updated_at
before update on public.price_rules
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    'viewer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.delete_booking_order(target_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in ('admin', 'staff') then
    raise exception 'Only admin or staff can delete booking orders';
  end if;

  delete from public.booking_orders
  where id = target_order_id;
end;
$$;

revoke all on function public.delete_booking_order(uuid) from public;
grant execute on function public.delete_booking_order(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.booking_orders enable row level security;
alter table public.bookings enable row level security;
alter table public.price_rules enable row level security;
alter table public.price_calendar enable row level security;

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
on public.profiles for select
to authenticated
using (id = auth.uid() or public.current_user_role() = 'admin');

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin"
on public.profiles for update
to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

drop policy if exists "rooms_select_authenticated" on public.rooms;
create policy "rooms_select_authenticated"
on public.rooms for select
to authenticated
using (true);

drop policy if exists "rooms_write_admin_staff" on public.rooms;
create policy "rooms_write_admin_staff"
on public.rooms for all
to authenticated
using (public.current_user_role() in ('admin', 'staff'))
with check (public.current_user_role() in ('admin', 'staff'));

drop policy if exists "booking_orders_select_authenticated" on public.booking_orders;
create policy "booking_orders_select_authenticated"
on public.booking_orders for select
to authenticated
using (true);

drop policy if exists "booking_orders_insert_admin_staff" on public.booking_orders;
create policy "booking_orders_insert_admin_staff"
on public.booking_orders for insert
to authenticated
with check (public.current_user_role() in ('admin', 'staff'));

drop policy if exists "booking_orders_update_admin_staff" on public.booking_orders;
create policy "booking_orders_update_admin_staff"
on public.booking_orders for update
to authenticated
using (public.current_user_role() in ('admin', 'staff'))
with check (public.current_user_role() in ('admin', 'staff'));

drop policy if exists "booking_orders_delete_admin" on public.booking_orders;
create policy "booking_orders_delete_admin"
on public.booking_orders for delete
to authenticated
using (public.current_user_role() = 'admin');

drop policy if exists "bookings_select_authenticated" on public.bookings;
create policy "bookings_select_authenticated"
on public.bookings for select
to authenticated
using (true);

drop policy if exists "bookings_insert_admin_staff" on public.bookings;
create policy "bookings_insert_admin_staff"
on public.bookings for insert
to authenticated
with check (public.current_user_role() in ('admin', 'staff'));

drop policy if exists "bookings_update_admin_staff" on public.bookings;
create policy "bookings_update_admin_staff"
on public.bookings for update
to authenticated
using (public.current_user_role() in ('admin', 'staff'))
with check (public.current_user_role() in ('admin', 'staff'));

drop policy if exists "bookings_delete_admin" on public.bookings;
create policy "bookings_delete_admin"
on public.bookings for delete
to authenticated
using (public.current_user_role() = 'admin');

drop policy if exists "price_rules_select_authenticated" on public.price_rules;
create policy "price_rules_select_authenticated"
on public.price_rules for select
to authenticated
using (true);

drop policy if exists "price_rules_write_admin_staff" on public.price_rules;
create policy "price_rules_write_admin_staff"
on public.price_rules for all
to authenticated
using (public.current_user_role() in ('admin', 'staff'))
with check (public.current_user_role() in ('admin', 'staff'));

drop policy if exists "price_calendar_select_authenticated" on public.price_calendar;
create policy "price_calendar_select_authenticated"
on public.price_calendar for select
to authenticated
using (true);

drop policy if exists "price_calendar_write_admin_staff" on public.price_calendar;
create policy "price_calendar_write_admin_staff"
on public.price_calendar for all
to authenticated
using (public.current_user_role() in ('admin', 'staff'))
with check (public.current_user_role() in ('admin', 'staff'));

insert into public.profiles (id, full_name, role)
select id, '系統管理員', 'admin'
from auth.users
where email = 'wutyimor@gmail.com'
on conflict (id) do update
set
  full_name = excluded.full_name,
  role = excluded.role;

insert into public.rooms (name, room_type, capacity, base_price, is_active)
values
  ('A1', '六人狩獵帳', 6, 0, true),
  ('A2', '四人狩獵帳', 4, 0, true),
  ('A3', '四人狩獵帳', 4, 0, true),
  ('A4', '四人狩獵帳', 4, 0, true),
  ('B1', '六人狩獵帳', 6, 0, true),
  ('B2', '四人狩獵帳', 4, 0, true),
  ('B3', '四人狩獵帳', 4, 0, true),
  ('B4', '四人狩獵帳', 4, 0, true),
  ('B5', '六人狩獵帳', 6, 0, true),
  ('B6', '六人狩獵帳', 6, 0, true),
  ('C1', '六人狩獵帳', 6, 0, true),
  ('C2', '四人狩獵帳', 4, 0, true),
  ('C3', '四人狩獵帳', 4, 0, true),
  ('C4', '四人狩獵帳', 4, 0, true),
  ('C5', '四人狩獵帳', 4, 0, true),
  ('D1', '四人玻璃屋', 4, 0, true),
  ('D2', '四人玻璃屋', 4, 0, true),
  ('D3', '四人玻璃屋', 4, 0, true),
  ('D4', '四人玻璃屋', 4, 0, true),
  ('D5', '四人玻璃屋', 4, 0, true),
  ('玻1', '八人玻璃屋', 8, 0, true),
  ('玻2', '六人玻璃屋', 6, 0, true),
  ('玻3', '八人玻璃屋', 8, 0, true)
on conflict (name) do update
set
  room_type = excluded.room_type,
  capacity = excluded.capacity,
  is_active = true;

delete from public.rooms
where name in ('A101', 'A102', 'B201', 'C301');

insert into public.price_rules (room_type, rate_category, price)
values
  ('四人狩獵帳', 'weekday', 3800),
  ('四人狩獵帳', 'friday_sunday_holiday', 4800),
  ('四人狩獵帳', 'saturday', 6800),
  ('四人狩獵帳', 'consecutive_holiday', 6800),

  ('六人狩獵帳', 'weekday', 5800),
  ('六人狩獵帳', 'friday_sunday_holiday', 6800),
  ('六人狩獵帳', 'saturday', 8800),
  ('六人狩獵帳', 'consecutive_holiday', 8800),

  ('四人玻璃屋', 'weekday', 5800),
  ('四人玻璃屋', 'friday_sunday_holiday', 6800),
  ('四人玻璃屋', 'saturday', 8800),
  ('四人玻璃屋', 'consecutive_holiday', 8800),

  ('六人玻璃屋', 'weekday', 6800),
  ('六人玻璃屋', 'friday_sunday_holiday', 9800),
  ('六人玻璃屋', 'saturday', 10800),
  ('六人玻璃屋', 'consecutive_holiday', 12800),

  ('八人玻璃屋', 'weekday', 8800),
  ('八人玻璃屋', 'friday_sunday_holiday', 10800),
  ('八人玻璃屋', 'saturday', 12800),
  ('八人玻璃屋', 'consecutive_holiday', 14800)
on conflict (room_type, rate_category) do update
set price = excluded.price;

select
  'admin' as check_type,
  u.email,
  p.full_name,
  p.role::text as value
from auth.users u
join public.profiles p on p.id = u.id
where u.email = 'wutyimor@gmail.com'

union all

select
  'room_count' as check_type,
  null as email,
  null as full_name,
  count(*)::text as value
from public.rooms
where is_active = true

union all

select
  'price_rule_count' as check_type,
  null as email,
  null as full_name,
  count(*)::text as value
from public.price_rules;
