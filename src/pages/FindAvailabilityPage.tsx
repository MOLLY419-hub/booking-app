import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ALL_CAMPS, useCamp } from '../contexts/CampContext';
import { getRoomTypeClass, getRoomTypeLabel, ROOM_TYPE_LEGEND, sortRoomsByDisplayOrder } from '../lib/rooms';
import { supabase } from '../lib/supabase';
import type { BookingWithRoom, PriceCalendar, PriceRule, RateCategory, Room } from '../types/database';

const today = formatLocalDate(new Date());

const WEEKDAY_OPTIONS = [
  { value: 0, label: '週日' },
  { value: 1, label: '週一' },
  { value: 2, label: '週二' },
  { value: 3, label: '週三' },
  { value: 4, label: '週四' },
  { value: 5, label: '週五' },
  { value: 6, label: '週六' },
];

type AvailabilityRequirement = {
  roomType: string;
  requestedCount: number;
  availableCount: number;
  totalCount: number;
  estimatedTotal: number;
};

type AvailabilityResult = {
  checkInDate: string;
  checkOutDate: string;
  availableCount: number;
  totalCount: number;
  estimatedTotal: number;
  rateLabels: string[];
  requirements: AvailabilityRequirement[];
};

export function FindAvailabilityPage() {
  const { selectedCampId } = useCamp();
  const [startDate, setStartDate] = useState(today);
  const [selectedRoomTypes, setSelectedRoomTypes] = useState<string[]>([]);
  const [roomTypeCounts, setRoomTypeCounts] = useState<Record<string, string>>({});
  const [nightCountInput, setNightCountInput] = useState('1');
  const [scanDaysInput, setScanDaysInput] = useState('120');
  const [weekdayFilter, setWeekdayFilter] = useState<number[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [bookings, setBookings] = useState<BookingWithRoom[]>([]);
  const [priceRules, setPriceRules] = useState<PriceRule[]>([]);
  const [priceCalendar, setPriceCalendar] = useState<PriceCalendar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const nightCount = normalizePositiveNumber(nightCountInput, 1);
  const scanDays = normalizePositiveNumber(scanDaysInput, 120);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setError('');

      const scanEnd = addDays(startDate, scanDays + nightCount + 1);
      let roomQuery = supabase.from('rooms').select('*').eq('is_active', true).order('name');
      let calendarQuery = supabase.from('price_calendar').select('*');
      let ruleQuery = supabase.from('price_rules').select('*');

      if (selectedCampId !== ALL_CAMPS) {
        roomQuery = roomQuery.eq('camp_id', selectedCampId);
        calendarQuery = calendarQuery.eq('camp_id', selectedCampId);
        ruleQuery = ruleQuery.eq('camp_id', selectedCampId);
      }

      const [roomResult, bookingResult, ruleResult, calendarResult] = await Promise.all([
        roomQuery,
        supabase
          .from('bookings')
          .select('*, rooms(id, camp_id, name, room_type, base_price)')
          .lt('check_in_date', scanEnd)
          .gt('check_out_date', startDate)
          .neq('status', 'cancelled')
          .order('check_in_date'),
        ruleQuery,
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

    loadData();
  }, [nightCount, scanDays, selectedCampId, startDate]);

  const roomTypeOptions = useMemo(() => {
    const availableTypes = Array.from(new Set(rooms.map((room) => getRoomTypeLabel(room))));
    const known = ROOM_TYPE_LEGEND.filter((item) => availableTypes.includes(item.label));
    const unknown = availableTypes
      .filter((label) => !known.some((item) => item.label === label))
      .map((label) => ({ label, className: getRoomTypeClass(label) }));
    return [...known, ...unknown];
  }, [rooms]);

  useEffect(() => {
    const optionLabels = roomTypeOptions.map((item) => item.label);
    setSelectedRoomTypes((current) => {
      const kept = current.filter((label) => optionLabels.includes(label));
      if (kept.length > 0) return kept;
      return optionLabels[0] ? [optionLabels[0]] : [];
    });
    setRoomTypeCounts((current) => {
      const next: Record<string, string> = {};
      optionLabels.forEach((label) => {
        next[label] = current[label] ?? '1';
      });
      return next;
    });
  }, [roomTypeOptions]);

  const requirements = useMemo(
    () =>
      selectedRoomTypes.map((roomType) => ({
        roomType,
        requestedCount: normalizePositiveNumber(roomTypeCounts[roomType], 1),
      })),
    [roomTypeCounts, selectedRoomTypes],
  );

  const results = useMemo(() => {
    if (requirements.length === 0) return [];

    const nextResults: AvailabilityResult[] = [];
    for (let dayIndex = 0; dayIndex < scanDays; dayIndex += 1) {
      const checkInDate = addDays(startDate, dayIndex);
      const checkInWeekday = parseLocalDate(checkInDate).getDay();
      if (weekdayFilter.length > 0 && !weekdayFilter.includes(checkInWeekday)) continue;

      const checkOutDate = addDays(checkInDate, nightCount);
      const occupiedRoomIds = new Set(
        bookings
          .filter((booking) => booking.check_in_date < checkOutDate && booking.check_out_date > checkInDate)
          .map((booking) => booking.room_id),
      );

      const requirementResults = requirements.map((requirement) => {
        const typeRooms = rooms.filter((room) => getRoomTypeLabel(room) === requirement.roomType);
        const availableRooms = typeRooms.filter((room) => !occupiedRoomIds.has(room.id));
        const representativeRoom = typeRooms[0];
        return {
          ...requirement,
          availableCount: availableRooms.length,
          totalCount: typeRooms.length,
          estimatedTotal: representativeRoom
            ? getStayPrice(representativeRoom, checkInDate, nightCount, priceRules, priceCalendar) *
              requirement.requestedCount
            : 0,
        };
      });

      if (requirementResults.every((item) => item.availableCount >= item.requestedCount)) {
        nextResults.push({
          checkInDate,
          checkOutDate,
          availableCount: requirementResults.reduce((sum, item) => sum + item.availableCount, 0),
          totalCount: requirementResults.reduce((sum, item) => sum + item.totalCount, 0),
          estimatedTotal: requirementResults.reduce((sum, item) => sum + item.estimatedTotal, 0),
          rateLabels: getStayRateLabels(checkInDate, nightCount, priceCalendar),
          requirements: requirementResults,
        });
      }

      if (nextResults.length >= 12) break;
    }

    return nextResults;
  }, [bookings, nightCount, priceCalendar, priceRules, requirements, rooms, scanDays, startDate, weekdayFilter]);

  function toggleWeekday(weekday: number) {
    setWeekdayFilter((current) =>
      current.includes(weekday) ? current.filter((item) => item !== weekday) : [...current, weekday].sort(),
    );
  }

  function toggleRoomType(roomType: string) {
    setSelectedRoomTypes((current) =>
      current.includes(roomType) ? current.filter((item) => item !== roomType) : [...current, roomType],
    );
  }

  function updateRoomTypeCount(roomType: string, value: string) {
    setRoomTypeCounts((current) => ({ ...current, [roomType]: value }));
  }

  const searchSummary = requirements.map((item) => `${item.roomType} ${item.requestedCount} 間`).join('、');

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">FIND AVAILABILITY</p>
          <h1>找空房</h1>
        </div>
      </div>

      <div className="form-panel">
        {error && <div className="form-error">{error}</div>}
        <div className="form-grid find-availability-form">
          <div className="subsection find-room-type-picker">
            <label>房型</label>
            <div className="room-type-legend room-type-legend-compact">
              {roomTypeOptions.map((item) => (
                <button
                  className={`legend-chip legend-filter ${item.className} ${
                    selectedRoomTypes.includes(item.label) ? 'active' : ''
                  }`}
                  key={item.label}
                  type="button"
                  onClick={() => toggleRoomType(item.label)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="subsection find-room-counts">
            <label>間數</label>
            {requirements.length === 0 ? (
              <div className="compact-empty">請先選擇房型</div>
            ) : (
              <div className="requirement-count-grid">
                {selectedRoomTypes.map((roomType) => (
                  <label key={roomType}>
                    {roomType}
                    <input
                      inputMode="numeric"
                      min="1"
                      type="number"
                      value={roomTypeCounts[roomType] ?? ''}
                      onChange={(event) => updateRoomTypeCount(roomType, event.target.value)}
                    />
                  </label>
                ))}
              </div>
            )}
          </div>

          <label>
            住宿晚數
            <input
              inputMode="numeric"
              min="1"
              type="number"
              value={nightCountInput}
              onChange={(event) => setNightCountInput(event.target.value)}
            />
          </label>
          <label>
            查詢起始日
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </label>
          <label>
            往後搜尋天數
            <input
              inputMode="numeric"
              max="365"
              min="1"
              type="number"
              value={scanDaysInput}
              onChange={(event) => setScanDaysInput(event.target.value)}
            />
          </label>
          <div className="weekday-filter-field">
            <span>指定入住星期</span>
            <div className="weekday-filter">
              <button
                className={`legend-chip legend-filter ${weekdayFilter.length === 0 ? 'active' : ''}`}
                type="button"
                onClick={() => setWeekdayFilter([])}
              >
                不限
              </button>
              {WEEKDAY_OPTIONS.map((item) => (
                <button
                  className={`legend-chip legend-filter ${weekdayFilter.includes(item.value) ? 'active' : ''}`}
                  key={item.value}
                  type="button"
                  onClick={() => toggleWeekday(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="table-panel find-availability-panel">
        <div className="panel-heading panel-heading-plain">
          <div>
            <p className="eyebrow">Search Result</p>
            <h2>最快可訂日期</h2>
          </div>
          <span className="subtext">
            {searchSummary || '尚未選擇房型'}，{nightCount} 晚，
            {weekdayFilter.length > 0
              ? weekdayFilter.map((day) => WEEKDAY_OPTIONS.find((item) => item.value === day)?.label).join('、')
              : '不限星期'}
          </span>
        </div>

        {loading ? (
          <div className="empty-state">載入中...</div>
        ) : results.length === 0 ? (
          <div className="empty-state">查無符合條件的可訂日期，請調整房型、間數、星期或搜尋天數。</div>
        ) : (
          <div className="find-result-grid">
            {results.map((result, index) => (
              <article className={`find-result-card ${index === 0 ? 'find-result-primary' : ''}`} key={result.checkInDate}>
                <div>
                  <span className="find-result-rank">{index === 0 ? '最快可訂' : `第 ${index + 1} 筆`}</span>
                  <h3>
                    {formatDisplayDate(result.checkInDate)} {formatWeekday(result.checkInDate)}
                  </h3>
                  <p>
                    退房 {formatDisplayDate(result.checkOutDate)}，{nightCount} 晚
                  </p>
                </div>
                <div className="find-result-meta">
                  {result.requirements.map((item) => (
                    <span key={item.roomType}>
                      {item.roomType} <strong>{item.availableCount}</strong> / {item.totalCount} 可訂，需要{' '}
                      {item.requestedCount} 間
                    </span>
                  ))}
                  <span>預估 {formatPrice(result.estimatedTotal)}</span>
                  <span>{result.rateLabels.join('、')}</span>
                </div>
                <Link className="secondary-button" to="/bookings/new">
                  <Search size={16} />
                  去新增訂房
                </Link>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function normalizePositiveNumber(value: string | number | undefined, fallback: number) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 1) return fallback;
  return Math.floor(numberValue);
}

function getStayPrice(room: Room, checkInDate: string, nightCount: number, rules: PriceRule[], calendar: PriceCalendar[]) {
  let total = 0;
  for (let index = 0; index < nightCount; index += 1) {
    total += getRoomNightPrice(room, addDays(checkInDate, index), rules, calendar);
  }
  return total;
}

function getStayRateLabels(checkInDate: string, nightCount: number, calendar: PriceCalendar[]) {
  const labels = new Set<string>();
  for (let index = 0; index < nightCount; index += 1) {
    labels.add(rateCategoryLabel(getRateCategory(null, addDays(checkInDate, index), calendar)));
  }
  return Array.from(labels);
}

function getRoomNightPrice(room: Room, date: string, rules: PriceRule[], calendar: PriceCalendar[]) {
  const customPrice = getCustomCalendarPrice(room.camp_id, room.room_type, date, calendar);
  if (customPrice !== null) return customPrice;

  const category = getRateCategory(room.camp_id, date, calendar);
  const rule =
    rules.find(
      (item) => item.camp_id === room.camp_id && item.room_type === room.room_type && item.rate_category === category,
    ) ??
    rules.find((item) => !item.camp_id && item.room_type === room.room_type && item.rate_category === category);
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

function rateCategoryLabel(category: RateCategory) {
  const labels: Record<RateCategory, string> = {
    weekday: '平日一到四',
    friday_sunday_holiday: '五、日、寒暑假',
    saturday: '週六',
    consecutive_holiday: '連續假日',
  };
  return labels[category];
}

function addDays(date: string, days: number) {
  const next = parseLocalDate(date);
  next.setDate(next.getDate() + days);
  return formatLocalDate(next);
}

function parseLocalDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(date: string) {
  const [year, month, day] = date.split('-');
  return `${year}/${month}/${day}`;
}

function formatWeekday(date: string) {
  const labels = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
  return labels[parseLocalDate(date).getDay()];
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0,
  }).format(Number(price || 0));
}
