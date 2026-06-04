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
