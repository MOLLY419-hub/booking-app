import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ALL_CAMPS, useCamp } from '../contexts/CampContext';
import { getRoomTypeClass, getRoomTypeLabel, ROOM_TYPE_LEGEND, sortRoomsByDisplayOrder } from '../lib/rooms';
import { supabase } from '../lib/supabase';
import type { BookingWithRoom, PriceCalendar, PriceRule, RateCategory, Room } from '../types/database';

const today = formatLocalDate(new Date());

export function AvailabilityPage() {
  const { selectedCampId } = useCamp();
  const [date, setDate] = useState(today);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(today));
  const [rooms, setRooms] = useState<Room[]>([]);
  const [bookings, setBookings] = useState<BookingWithRoom[]>([]);
  const [priceRules, setPriceRules] = useState<PriceRule[]>([]);
  const [priceCalendar, setPriceCalendar] = useState<PriceCalendar[]>([]);
  const [roomTypeFilter, setRoomTypeFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadAvailability() {
      setLoading(true);
      setError('');

      let roomQuery = supabase.from('rooms').select('*').eq('is_active', true).order('name');
      let calendarQuery = supabase.from('price_calendar').select('*');

      if (selectedCampId !== ALL_CAMPS) {
        roomQuery = roomQuery.eq('camp_id', selectedCampId);
        calendarQuery = calendarQuery.eq('camp_id', selectedCampId);
      }

      const [roomResult, bookingResult, ruleResult, calendarResult] = await Promise.all([
        roomQuery,
        supabase
          .from('bookings')
          .select('*, rooms(id, camp_id, name, room_type, base_price)')
          .lte('check_in_date', date)
          .gt('check_out_date', date)
          .neq('status', 'cancelled')
          .order('check_in_date'),
        supabase.from('price_rules').select('*'),
        calendarQuery,
      ]);

      if (roomResult.error) {
        setError(roomResult.error.message);
      } else if (bookingResult.error) {
        setError(bookingResult.error.message);
      } else if (ruleResult.error) {
        setError(ruleResult.error.message);
      } else if (calendarResult.error) {
        setError(calendarResult.error.message);
      } else {
        const nextRooms = sortRoomsByDisplayOrder(roomResult.data ?? []);
        const roomIds = new Set(nextRooms.map((room) => room.id));
        setRooms(nextRooms);
        setBookings(
          ((bookingResult.data as BookingWithRoom[]) ?? []).filter(
            (booking) => selectedCampId === ALL_CAMPS || roomIds.has(booking.room_id),
          ),
        );
        setPriceRules(ruleResult.data ?? []);
        setPriceCalendar(calendarResult.data ?? []);
      }

      setLoading(false);
    }

    loadAvailability();
  }, [date, selectedCampId]);

  const bookedByRoomId = useMemo(() => new Map(bookings.map((booking) => [booking.room_id, booking])), [bookings]);

  const visibleRooms = useMemo(
    () =>
      rooms.filter((room) => {
        if (roomTypeFilter === 'all') return true;
        if (roomTypeFilter === 'booked') return bookedByRoomId.has(room.id);
        return getRoomTypeLabel(room) === roomTypeFilter;
      }),
    [bookedByRoomId, roomTypeFilter, rooms],
  );

  const availableRooms = visibleRooms.filter((room) => !bookedByRoomId.has(room.id));
  const bookedRooms = visibleRooms.filter((room) => bookedByRoomId.has(room.id));

  const roomTypeCounts = useMemo(
    () =>
      ROOM_TYPE_LEGEND.map((item) => {
        const typeRooms = rooms.filter((room) => getRoomTypeLabel(room) === item.label);
        const availableCount = typeRooms.filter((room) => !bookedByRoomId.has(room.id)).length;
        return {
          ...item,
          totalCount: typeRooms.length,
          availableCount,
        };
      }).filter((item) => item.totalCount > 0),
    [bookedByRoomId, rooms],
  );

  function moveDate(days: number) {
    const next = parseLocalDate(date);
    next.setDate(next.getDate() + days);
    const nextDate = formatLocalDate(next);
    setDate(nextDate);
    setCalendarMonth(startOfMonth(nextDate));
  }

  function selectDate(nextDate: string) {
    setDate(nextDate);
    setCalendarMonth(startOfMonth(nextDate));
    setIsCalendarOpen(false);
  }

  function moveCalendarMonth(months: number) {
    const next = parseLocalDate(calendarMonth);
    next.setMonth(next.getMonth() + months);
    setCalendarMonth(formatLocalDate(next));
  }

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Availability</p>
          <h1>空房日曆</h1>
        </div>
      </div>

      <div className="form-panel date-control-panel">
        <div className="availability-datebar date-control-bar">
          <span className="date-control-label">查看日期</span>
          <button className="secondary-button" type="button" onClick={() => moveDate(-1)}>
            <ChevronLeft size={18} />
            前一天
          </button>
          <div className="date-picker-wrap">
            <button
              className="date-control-input date-picker-trigger"
              type="button"
              onClick={() => setIsCalendarOpen((current) => !current)}
            >
              <b>{formatDisplayDate(date)}</b>
            </button>
            {isCalendarOpen && (
              <CuteCalendar
                month={calendarMonth}
                selectedDate={date}
                onMoveMonth={moveCalendarMonth}
                onSelect={selectDate}
              />
            )}
          </div>
          <button className="secondary-button" type="button" onClick={() => moveDate(1)}>
            後一天
            <ChevronRight size={18} />
          </button>
          <div className="field-preview">
            <span>可訂 / 總房數</span>
            <strong>
              {availableRooms.length} / {visibleRooms.length}
            </strong>
          </div>
        </div>
      </div>

      <div className="metric-grid">
        <article className="metric metric-available">
          <span>可訂房間</span>
          <strong>{availableRooms.length}</strong>
        </article>
        <article className="metric">
          <span>已訂房間</span>
          <strong>{bookedRooms.length}</strong>
        </article>
        <article className="metric">
          <span>查看日期</span>
          <strong>{formatDisplayDateWithWeekday(date)}</strong>
        </article>
      </div>

      <div className="table-panel">
        {error && <div className="form-error">{error}</div>}
        {loading ? (
          <div className="empty-state">載入中...</div>
        ) : (
          <>
            <div className="room-type-legend">
              <button
                className={`legend-chip legend-filter ${roomTypeFilter === 'all' ? 'active' : ''}`}
                type="button"
                onClick={() => setRoomTypeFilter('all')}
              >
                全部 {rooms.length - bookedByRoomId.size}/{rooms.length}
              </button>
              {roomTypeCounts.map((item) => (
                <button
                  className={`legend-chip legend-filter ${item.className} ${roomTypeFilter === item.label ? 'active' : ''}`}
                  key={item.label}
                  type="button"
                  onClick={() => setRoomTypeFilter(item.label)}
                >
                  {item.label} {item.availableCount}/{item.totalCount}
                </button>
              ))}
              <button
                className={`legend-chip legend-filter legend-booked ${roomTypeFilter === 'booked' ? 'active' : ''}`}
                type="button"
                onClick={() => setRoomTypeFilter('booked')}
              >
                已被預訂 {bookedByRoomId.size}
              </button>
            </div>
            <div className="availability-grid">
              {visibleRooms.map((room) => {
                const booking = bookedByRoomId.get(room.id);
                const roomTypeClass = getRoomTypeClass(getRoomTypeLabel(room));
                const roomPrice = getRoomNightPrice(room, date, priceRules, priceCalendar);
                return (
                  <article
                    className={`availability-room ${booking ? 'availability-booked' : roomTypeClass}`}
                    key={room.id}
                  >
                    <div>
                      <strong>{getRoomTypeLabel(room)}</strong>
                      <span>{formatPrice(roomPrice)}</span>
                    </div>
                    {booking ? (
                      <div>
                        <span className="availability-badge">已訂</span>
                        <small>
                          {booking.guest_name} {getNightCount(booking.check_in_date, booking.check_out_date)}晚
                        </small>
                      </div>
                    ) : (
                      <div>
                        <span className="availability-badge">可訂</span>
                        <small>此日期尚未被預訂</small>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function CuteCalendar({
  month,
  selectedDate,
  onMoveMonth,
  onSelect,
}: {
  month: string;
  selectedDate: string;
  onMoveMonth: (months: number) => void;
  onSelect: (date: string) => void;
}) {
  const monthDate = parseLocalDate(month);
  const year = monthDate.getFullYear();
  const monthIndex = monthDate.getMonth();
  const monthLabel = `${year}年${String(monthIndex + 1).padStart(2, '0')}月`;
  const days = buildCalendarDays(month);

  return (
    <div className="cute-calendar" role="dialog" aria-label="選擇日期">
      <div className="cute-calendar-head">
        <strong>{monthLabel}</strong>
        <div>
          <button type="button" onClick={() => onMoveMonth(-1)}>
            ‹
          </button>
          <button type="button" onClick={() => onMoveMonth(1)}>
            ›
          </button>
        </div>
      </div>
      <div className="cute-calendar-weekdays">
        {['日', '一', '二', '三', '四', '五', '六'].map((weekday) => (
          <span key={weekday}>{weekday}</span>
        ))}
      </div>
      <div className="cute-calendar-grid">
        {days.map((day) => (
          <button
            className={[
              'cute-calendar-day',
              day.inMonth ? '' : 'muted',
              day.date === selectedDate ? 'selected' : '',
              day.date === today ? 'today' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            key={day.date}
            type="button"
            onClick={() => onSelect(day.date)}
          >
            {parseLocalDate(day.date).getDate()}
          </button>
        ))}
      </div>
    </div>
  );
}

function startOfMonth(date: string) {
  const parsed = parseLocalDate(date);
  return formatLocalDate(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
}

function buildCalendarDays(month: string) {
  const first = parseLocalDate(month);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return {
      date: formatLocalDate(day),
      inMonth: day.getMonth() === first.getMonth(),
    };
  });
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDisplayDate(date: string) {
  const [year, month, day] = date.split('-');
  return `${year}/${month}/${day}`;
}

function formatDisplayDateWithWeekday(date: string) {
  return `${formatDisplayDate(date)} ${formatWeekday(date)}`;
}

function formatWeekday(date: string) {
  const labels = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
  return labels[parseLocalDate(date).getDay()];
}

function getRoomNightPrice(room: Room, date: string, rules: PriceRule[], calendar: PriceCalendar[]) {
  const customPrice = getCustomCalendarPrice(room.camp_id, room.room_type, date, calendar);
  if (customPrice !== null) return customPrice;

  const category = getRateCategory(room.camp_id, date, calendar);
  const rule =
    rules.find(
      (item) => item.camp_id === room.camp_id && item.room_type === room.room_type && item.rate_category === category,
    ) ??
    rules.find(
      (item) => !item.camp_id && item.room_type === room.room_type && item.rate_category === category,
    );
  return Number(rule?.price ?? room.base_price ?? 0);
}

function getCustomCalendarPrice(campId: string | null, roomType: string | null, date: string, calendar: PriceCalendar[]) {
  if (!roomType) return null;
  const override = calendar.find((item) => item.date === date && (!campId || !item.camp_id || item.camp_id === campId));
  const customPrice = override?.custom_prices?.[roomType];
  const price = Number(customPrice);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function getRateCategory(campId: string | null, date: string, calendar: PriceCalendar[]): RateCategory {
  const override = calendar.find((item) => item.date === date && (!campId || !item.camp_id || item.camp_id === campId));
  if (override) return override.rate_category;

  const day = parseLocalDate(date).getDay();
  if (day === 6) return 'saturday';
  if (day === 5 || day === 0) return 'friday_sunday_holiday';
  return 'weekday';
}

function getNightCount(checkInDate: string, checkOutDate: string) {
  const checkIn = parseLocalDate(checkInDate).getTime();
  const checkOut = parseLocalDate(checkOutDate).getTime();
  const days = Math.round((checkOut - checkIn) / 86400000);
  return Math.max(days, 1);
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0,
  }).format(price);
}
