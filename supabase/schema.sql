-- Internal booking management MVP schema
-- Run this in Supabase SQL Editor after creating the project.

create extension if not exists "pgcrypto";

do $$
begin
  create type public.app_role as enum ('admin', 'staff', 'viewer');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.booking_status as enum ('pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled');
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
  status public.booking_status not null default 'confirmed',
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

create index if not exists bookings_room_date_idx
  on public.bookings (room_id, check_in_date, check_out_date);

create index if not exists booking_orders_date_idx
  on public.booking_orders (check_in_date, check_out_date);

create index if not exists bookings_order_id_idx
  on public.bookings (order_id);

create index if not exists bookings_status_idx
  on public.bookings (status);

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

drop policy if exists "bookings_select_authenticated" on public.bookings;
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

insert into public.rooms (name, room_type, capacity, base_price)
values
  ('A1', '六人狩獵帳', 6, 0),
  ('A2', '四人狩獵帳', 4, 0),
  ('A3', '四人狩獵帳', 4, 0),
  ('A4', '四人狩獵帳', 4, 0),
  ('B1', '六人狩獵帳', 6, 0),
  ('B2', '四人狩獵帳', 4, 0),
  ('B3', '四人狩獵帳', 4, 0),
  ('B4', '四人狩獵帳', 4, 0),
  ('B5', '六人狩獵帳', 6, 0),
  ('B6', '六人狩獵帳', 6, 0),
  ('C1', '六人狩獵帳', 6, 0),
  ('C2', '四人狩獵帳', 4, 0),
  ('C3', '四人狩獵帳', 4, 0),
  ('C4', '四人狩獵帳', 4, 0),
  ('C5', '四人狩獵帳', 4, 0),
  ('D1', '四人玻璃屋', 4, 0),
  ('D2', '四人玻璃屋', 4, 0),
  ('D3', '四人玻璃屋', 4, 0),
  ('D4', '四人玻璃屋', 4, 0),
  ('D5', '四人玻璃屋', 4, 0),
  ('玻1', '八人玻璃屋', 8, 0),
  ('玻2', '六人玻璃屋', 6, 0),
  ('玻3', '八人玻璃屋', 8, 0)
on conflict (name) do nothing;

-- After creating Auth users, promote the first administrator manually:
-- update public.profiles set role = 'admin', full_name = 'Admin Name' where id = '<auth-user-uuid>';
