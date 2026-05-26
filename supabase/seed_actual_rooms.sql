-- Replace sample rooms with the real fixed room list.
-- Old sample rooms are deleted.

alter table public.rooms
add column if not exists base_price numeric(10, 2) not null default 0 check (base_price >= 0);

insert into public.rooms (name, room_type, capacity, base_price, is_active)
values
  ('A2', '四人狩獵帳', 4, 0, true),
  ('A3', '四人狩獵帳', 4, 0, true),
  ('A4', '四人狩獵帳', 4, 0, true),
  ('B2', '四人狩獵帳', 4, 0, true),
  ('B3', '四人狩獵帳', 4, 0, true),
  ('B4', '四人狩獵帳', 4, 0, true),
  ('C2', '四人狩獵帳', 4, 0, true),
  ('C3', '四人狩獵帳', 4, 0, true),
  ('C4', '四人狩獵帳', 4, 0, true),
  ('C5', '四人狩獵帳', 4, 0, true),
  ('D1', '四人玻璃屋', 4, 0, true),
  ('D2', '四人玻璃屋', 4, 0, true),
  ('D3', '四人玻璃屋', 4, 0, true),
  ('D4', '四人玻璃屋', 4, 0, true),
  ('D5', '四人玻璃屋', 4, 0, true),
  ('A1', '六人狩獵帳', 6, 0, true),
  ('B1', '六人狩獵帳', 6, 0, true),
  ('B5', '六人狩獵帳', 6, 0, true),
  ('B6', '六人狩獵帳', 6, 0, true),
  ('C1', '六人狩獵帳', 6, 0, true),
  ('玻2', '六人玻璃屋', 6, 0, true),
  ('玻1', '八人玻璃屋', 8, 0, true),
  ('玻3', '八人玻璃屋', 8, 0, true)
on conflict (name) do update
set
  room_type = excluded.room_type,
  capacity = excluded.capacity,
  is_active = true;

delete from public.rooms
where name in ('A101', 'A102', 'B201', 'C301');

select name, room_type, capacity, base_price, is_active
from public.rooms
order by array_position(
  array[
    'A2', 'A3', 'A4',
    'B2', 'B3', 'B4',
    'C2', 'C3', 'C4', 'C5',
    'D1', 'D2', 'D3', 'D4', 'D5',
    'A1', 'B1', 'B5', 'B6', 'C1',
    '玻2', '玻1', '玻3'
  ],
  name
);
