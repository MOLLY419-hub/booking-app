-- Add date-based price rules for the 2026 price table.
-- Run this in Supabase SQL Editor.

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
  created_at timestamptz not null default now()
);

drop trigger if exists set_price_rules_updated_at on public.price_rules;
create trigger set_price_rules_updated_at
before update on public.price_rules
for each row execute function public.set_updated_at();

alter table public.price_rules enable row level security;
alter table public.price_calendar enable row level security;

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

-- Use this table to override dates that cannot be inferred from weekday.
-- Example:
-- insert into public.price_calendar (date, rate_category, label)
-- values ('2026-02-16', 'consecutive_holiday', '春節連假')
-- on conflict (date) do update
-- set rate_category = excluded.rate_category, label = excluded.label;

select room_type, rate_category, price
from public.price_rules
order by room_type, rate_category;
