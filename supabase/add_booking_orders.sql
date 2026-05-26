-- Upgrade existing MVP database to support multi-room booking orders and payments.
-- Run this in Supabase SQL Editor.

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

alter table public.bookings
add column if not exists order_id uuid references public.booking_orders(id) on delete cascade;

alter table public.bookings
add column if not exists room_price numeric(10, 2) not null default 0 check (room_price >= 0);

create index if not exists booking_orders_date_idx
  on public.booking_orders (check_in_date, check_out_date);

create index if not exists bookings_order_id_idx
  on public.bookings (order_id);

drop trigger if exists set_booking_orders_updated_at on public.booking_orders;
create trigger set_booking_orders_updated_at
before update on public.booking_orders
for each row execute function public.set_updated_at();

alter table public.booking_orders enable row level security;

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

-- Backfill old single-room bookings into orders so the new order list can still show them.
insert into public.booking_orders (
  guest_name,
  guest_phone,
  company_contact,
  check_in_date,
  check_out_date,
  room_count,
  total_amount,
  deposit_amount,
  balance_amount,
  status,
  note,
  created_by,
  updated_by,
  created_at,
  updated_at
)
select
  b.guest_name,
  b.guest_phone,
  b.company_contact,
  b.check_in_date,
  greatest(b.check_out_date, b.check_in_date + interval '1 day')::date,
  1,
  coalesce(nullif(b.room_price, 0), r.base_price, 0),
  0,
  coalesce(nullif(b.room_price, 0), r.base_price, 0),
  b.status,
  b.note,
  b.created_by,
  b.updated_by,
  b.created_at,
  b.updated_at
from public.bookings b
left join public.rooms r on r.id = b.room_id
where b.order_id is null;

with unmatched as (
  select
    b.id as booking_id,
    o.id as order_id,
    coalesce(nullif(b.room_price, 0), r.base_price, 0) as room_price
  from public.bookings b
  join public.booking_orders o
    on o.guest_name = b.guest_name
   and o.check_in_date = b.check_in_date
   and o.created_at = b.created_at
  left join public.rooms r on r.id = b.room_id
  where b.order_id is null
)
update public.bookings b
set
  order_id = unmatched.order_id,
  room_price = unmatched.room_price
from unmatched
where b.id = unmatched.booking_id;
