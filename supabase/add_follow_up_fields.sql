-- Add order follow-up fields for cancellation/postponement and invoice tracking.

alter table public.booking_orders
add column if not exists cancellation_postponement boolean not null default false;

alter table public.booking_orders
add column if not exists invoice_status text not null default 'not_issued'
check (invoice_status in ('not_issued', 'issued'));

update public.booking_orders
set
  cancellation_postponement = coalesce(cancellation_postponement, false),
  invoice_status = coalesce(invoice_status, 'not_issued');

select
  guest_name,
  check_in_date,
  check_out_date,
  cancellation_postponement,
  invoice_status
from public.booking_orders
where cancellation_postponement = true
   or invoice_status = 'not_issued'
order by check_in_date;
