-- Upgrade invoice workflow:
-- none = 不需發票
-- month_end = 需要發票，月底開立
-- onsite = 需要發票，現場開立
-- issued = 已開發票

alter table public.booking_orders
add column if not exists invoice_note text;

do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select conname
    from pg_constraint
    where conrelid = 'public.booking_orders'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%invoice_status%'
  loop
    execute format('alter table public.booking_orders drop constraint %I', constraint_record.conname);
  end loop;
end $$;

alter table public.booking_orders
alter column invoice_status set default 'none';

update public.booking_orders
set invoice_status = case
  when invoice_status = 'issued' then 'issued'
  when invoice_status = 'month_end' then 'month_end'
  when invoice_status = 'onsite' then 'onsite'
  else 'none'
end;

alter table public.booking_orders
add constraint booking_orders_invoice_status_check
check (invoice_status in ('none', 'month_end', 'onsite', 'issued'));

select
  guest_name,
  check_in_date,
  check_out_date,
  invoice_status,
  invoice_note
from public.booking_orders
where invoice_status in ('month_end', 'onsite')
order by check_in_date;
