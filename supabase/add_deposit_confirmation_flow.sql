-- Add deposit reconciliation flow.
-- New orders:
-- - no last five digits => pending
-- - last five digits entered => awaiting_deposit_confirmation
-- - staff confirms bank deposit => confirmed

alter type public.booking_status
add value if not exists 'awaiting_deposit_confirmation';

alter table public.booking_orders
add column if not exists deposit_confirmed boolean not null default false;

alter table public.booking_orders
add column if not exists deposit_confirmed_at timestamptz;

alter table public.booking_orders
alter column status set default 'pending';

alter table public.bookings
alter column status set default 'pending';

update public.booking_orders
set status = 'awaiting_deposit_confirmation'
where status = 'pending'
  and deposit_payment_last5 is not null
  and deposit_confirmed = false;

update public.booking_orders
set
  status = 'confirmed',
  deposit_confirmed = true,
  deposit_confirmed_at = coalesce(deposit_confirmed_at, updated_at)
where status = 'confirmed'
  and deposit_payment_last5 is not null
  and deposit_confirmed = false;

select
  status,
  deposit_confirmed,
  count(*) as order_count
from public.booking_orders
group by status, deposit_confirmed
order by status, deposit_confirmed;
