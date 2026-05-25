-- Add fixed room prices to an existing MVP database.
-- Run this if you already executed the earlier schema before room prices existed.

alter table public.rooms
add column if not exists base_price numeric(10, 2) not null default 0 check (base_price >= 0);

update public.rooms
set base_price = case name
  when 'A101' then 2800
  when 'A102' then 2800
  when 'B201' then 3600
  when 'C301' then 5200
  else base_price
end;

select name, room_type, capacity, base_price, is_active
from public.rooms
order by name;
