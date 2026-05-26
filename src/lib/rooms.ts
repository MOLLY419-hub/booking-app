import type { Room } from '../types/database';

export const ROOM_DISPLAY_ORDER = [
  'A2',
  'A3',
  'A4',
  'B2',
  'B3',
  'B4',
  'C2',
  'C3',
  'C4',
  'C5',
  'D1',
  'D2',
  'D3',
  'D4',
  'D5',
  'A1',
  'B1',
  'B5',
  'B6',
  'C1',
  '玻2',
  '玻1',
  '玻3',
  'K1',
];

const roomOrder = new Map(ROOM_DISPLAY_ORDER.map((name, index) => [name, index]));

const ROOM_TYPE_ORDER = [
  '四人狩獵帳',
  '六人狩獵帳',
  '四人玻璃屋',
  '六人玻璃屋',
  '八人玻璃屋',
  '四人小木屋',
  '六人樓中樓',
  'KTV包廂',
];

const roomTypeOrder = new Map(ROOM_TYPE_ORDER.map((name, index) => [name, index]));

export function sortRoomsByDisplayOrder<T extends Pick<Room, 'name'> & Partial<Pick<Room, 'room_type'>>>(rooms: T[]) {
  return [...rooms].sort((left, right) => {
    const leftTypeIndex = roomTypeOrder.get(left.room_type || '') ?? Number.MAX_SAFE_INTEGER;
    const rightTypeIndex = roomTypeOrder.get(right.room_type || '') ?? Number.MAX_SAFE_INTEGER;
    if (leftTypeIndex !== rightTypeIndex) return leftTypeIndex - rightTypeIndex;

    const leftIndex = roomOrder.get(left.name) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = roomOrder.get(right.name) ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return left.name.localeCompare(right.name, 'zh-Hant');
  });
}

export function getRoomTypeLabel(room: Pick<Room, 'room_type'> | null | undefined) {
  return room?.room_type || '未設定房型';
}

export const ROOM_TYPE_LEGEND = [
  { label: '四人狩獵帳', className: 'room-type-hunt-4' },
  { label: '六人狩獵帳', className: 'room-type-hunt-6' },
  { label: '四人玻璃屋', className: 'room-type-glass-4' },
  { label: '六人玻璃屋', className: 'room-type-glass-6' },
  { label: '八人玻璃屋', className: 'room-type-glass-8' },
  { label: '四人小木屋', className: 'room-type-cabin-4' },
  { label: '六人樓中樓', className: 'room-type-loft-6' },
  { label: 'KTV包廂', className: 'room-type-ktv' },
];

export const CUSTOM_PRICE_ROOM_TYPES = ROOM_TYPE_LEGEND.map((item) => item.label);

export function getRoomTypeClass(roomType: string) {
  if (roomType === '四人狩獵帳') return 'room-type-hunt-4';
  if (roomType === '六人狩獵帳') return 'room-type-hunt-6';
  if (roomType === '四人玻璃屋') return 'room-type-glass-4';
  if (roomType === '六人玻璃屋') return 'room-type-glass-6';
  if (roomType === '八人玻璃屋') return 'room-type-glass-8';
  if (roomType === '四人小木屋') return 'room-type-cabin-4';
  if (roomType === '六人樓中樓') return 'room-type-loft-6';
  if (roomType === 'KTV包廂') return 'room-type-ktv';
  return 'room-type-unknown';
}
