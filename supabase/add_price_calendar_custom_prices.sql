-- Add per-room-type custom prices for special dates.
-- Run once in Supabase SQL Editor.

alter table public.price_calendar
add column if not exists custom_prices jsonb;

comment on column public.price_calendar.custom_prices is
'Optional per-room-type price override, for example {"四人狩獵帳": 5200, "六人狩獵帳": 7200}.';

update public.price_calendar
set custom_prices = null
where custom_prices is null;
