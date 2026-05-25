import { Trash2 } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ALL_CAMPS, useCamp } from '../contexts/CampContext';
import { CUSTOM_PRICE_ROOM_TYPES, getRoomTypeLabel, sortRoomsByDisplayOrder } from '../lib/rooms';
import { supabase } from '../lib/supabase';
import type { PriceCalendar, RateCategory, Room } from '../types/database';

type CalendarForm = {
  start_date: string;
  end_date: string;
  rate_category: RateCategory;
  label: string;
  custom_prices: Record<string, string>;
};

const today = formatLocalDate(new Date());
const fallbackCustomPriceRoomTypes = CUSTOM_PRICE_ROOM_TYPES;

export function PriceCalendarPage() {
  const { camps, selectedCampId, setSelectedCampId } = useCamp();
  const [pageCampId, setPageCampId] = useState('');
  const [items, setItems] = useState<PriceCalendar[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<CalendarForm>({
    start_date: today,
    end_date: today,
    rate_category: 'consecutive_holiday',
    label: '',
    custom_prices: emptyCustomPrices(fallbackCustomPriceRoomTypes),
  });

  useEffect(() => {
    if (selectedCampId !== ALL_CAMPS) {
      setPageCampId(selectedCampId);
      return;
    }
    setPageCampId((current) => current || camps[0]?.id || '');
  }, [camps, selectedCampId]);

  useEffect(() => {
    loadItems();
  }, [pageCampId]);

  const customPriceRoomTypes = useMemo(() => {
    const roomTypes = Array.from(new Set(rooms.map((room) => getRoomTypeLabel(room))));
    const sortedTypes = fallbackCustomPriceRoomTypes.filter((roomType) => roomTypes.includes(roomType));
    return sortedTypes.length > 0 ? sortedTypes : fallbackCustomPriceRoomTypes;
  }, [rooms]);

  useEffect(() => {
    setForm((current) => ({ ...current, custom_prices: emptyCustomPrices(customPriceRoomTypes) }));
  }, [customPriceRoomTypes]);

  async function loadItems() {
    if (!pageCampId) {
      setItems([]);
      setRooms([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    const [calendarResult, roomResult] = await Promise.all([
      supabase.from('price_calendar').select('*').eq('camp_id', pageCampId).order('date'),
      supabase.from('rooms').select('*').eq('camp_id', pageCampId).eq('is_active', true),
    ]);

    if (calendarResult.error || roomResult.error) {
      setError(calendarResult.error?.message || roomResult.error?.message || '載入價格日曆失敗');
    } else {
      setItems(calendarResult.data ?? []);
      setRooms(sortRoomsByDisplayOrder(roomResult.data ?? []));
    }

    setLoading(false);
  }

  function handleCampChange(campId: string) {
    setPageCampId(campId);
    setSelectedCampId(campId);
  }

  async function saveItem(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');

    if (!pageCampId || pageCampId === ALL_CAMPS) {
      setError('請先選擇要設定價格的營區。');
      setSaving(false);
      return;
    }

    if (!isValidDateString(form.start_date) || !isValidDateString(form.end_date)) {
      setError('請確認開始日期與結束日期格式正確。');
      setSaving(false);
      return;
    }

    if (form.end_date < form.start_date) {
      setError('結束日期不能早於開始日期。');
      setSaving(false);
      return;
    }

    const customPrices = normalizeCustomPrices(form.custom_prices);
    const dateRange = datesBetweenInclusive(form.start_date, form.end_date);
    const rows = dateRange.map((date) => ({
      camp_id: pageCampId,
      date,
      rate_category: form.rate_category,
      label: form.label.trim() || null,
      custom_prices: Object.keys(customPrices).length > 0 ? customPrices : null,
    }));
    const { error: saveError } = await supabase.from('price_calendar').upsert(rows, { onConflict: 'camp_id,date' });

    if (saveError) {
      setError(saveError.message);
    } else {
      setForm((current) => ({ ...current, label: '', custom_prices: emptyCustomPrices(customPriceRoomTypes) }));
      await loadItems();
    }
    setSaving(false);
  }

  async function deleteItem(item: PriceCalendar) {
    setError('');
    let query = supabase.from('price_calendar').delete().eq('date', item.date);
    if (item.camp_id) {
      query = query.eq('camp_id', item.camp_id);
    }
    const { error: deleteError } = await query;
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    await loadItems();
  }

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Price calendar</p>
          <h1>價格日曆</h1>
        </div>
      </div>

      <div className="form-panel">
        <form className="form-grid" onSubmit={saveItem}>
          {error && <div className="form-error">{error}</div>}

          <label className="wide">
            營區
            <select value={pageCampId} onChange={(event) => handleCampChange(event.target.value)} required>
              <option value="" disabled>
                請選擇營區
              </option>
              {camps.map((camp) => (
                <option key={camp.id} value={camp.id}>
                  {camp.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            開始日期
            <input
              type="date"
              value={form.start_date}
              onChange={(event) =>
                setForm((current) => {
                  const startDate = event.target.value;
                  return {
                    ...current,
                    start_date: startDate,
                    end_date: current.end_date < startDate ? startDate : current.end_date,
                  };
                })
              }
              required
            />
          </label>

          <label>
            結束日期
            <input
              type="date"
              value={form.end_date}
              onChange={(event) => setForm((current) => ({ ...current, end_date: event.target.value }))}
              required
            />
          </label>

          <label>
            價格類型
            <select
              value={form.rate_category}
              onChange={(event) =>
                setForm((current) => ({ ...current, rate_category: event.target.value as RateCategory }))
              }
            >
              <option value="friday_sunday_holiday">五、日、寒暑假</option>
              <option value="saturday">週六</option>
              <option value="consecutive_holiday">連續假日</option>
            </select>
          </label>

          <label className="wide">
            備註
            <input
              value={form.label}
              onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
              placeholder="例如 春節連假、暑假、國慶連假"
            />
          </label>

          <section className="wide custom-price-section">
            <div>
              <strong>自訂區間房價</strong>
              <p className="subtext">
                特殊節日可直接填房價；空白則沿用上方價格類型的固定價格。區間內每日都會套用同一組設定。
              </p>
            </div>
            <div className="custom-price-grid">
              {customPriceRoomTypes.map((roomType) => (
                <label key={roomType}>
                  {roomType}
                  <input
                    min={0}
                    type="number"
                    value={form.custom_prices[roomType] ?? ''}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        custom_prices: {
                          ...current.custom_prices,
                          [roomType]: event.target.value,
                        },
                      }))
                    }
                    placeholder="不填用固定價"
                  />
                </label>
              ))}
            </div>
          </section>

          <div className="form-actions wide">
            <button className="primary-button" disabled={saving}>
              {saving ? '儲存中...' : '新增或更新特殊日期區間'}
            </button>
          </div>
        </form>
      </div>

      <div className="table-panel">
        {loading ? (
          <div className="empty-state">載入中...</div>
        ) : items.length === 0 ? (
          <div className="empty-state">尚未設定特殊日期</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>日期</th>
                  <th>價格類型</th>
                  <th>自訂房價</th>
                  <th>備註</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={`${item.camp_id || 'none'}-${item.date}`}>
                    <td>{formatDisplayDate(item.date)}</td>
                    <td>
                      <span className="status status-confirmed">{rateCategoryLabel(item.rate_category)}</span>
                    </td>
                    <td>{formatCustomPrices(item.custom_prices)}</td>
                    <td>{item.label || '-'}</td>
                    <td>
                      <button className="icon-button" onClick={() => deleteItem(item)} title="刪除">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function emptyCustomPrices(roomTypes = fallbackCustomPriceRoomTypes) {
  return Object.fromEntries(roomTypes.map((roomType) => [roomType, '']));
}

function normalizeCustomPrices(values: Record<string, string>) {
  return Object.entries(values).reduce<Record<string, number>>((prices, [roomType, value]) => {
    const price = Number(value);
    if (Number.isFinite(price) && price > 0) {
      prices[roomType] = price;
    }
    return prices;
  }, {});
}

function formatCustomPrices(customPrices: PriceCalendar['custom_prices']) {
  if (!customPrices || Object.keys(customPrices).length === 0) return '-';
  return Object.entries(customPrices)
    .filter(([, price]) => Number(price) > 0)
    .map(([roomType, price]) => `${roomType} ${formatPrice(Number(price))}`)
    .join('、');
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

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function datesBetweenInclusive(startDate: string, endDate: string) {
  const dates: string[] = [];
  const current = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);

  while (current <= end) {
    dates.push(formatLocalDate(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

function parseLocalDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function isValidDateString(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsedDate = parseLocalDate(date);
  return !Number.isNaN(parsedDate.getTime()) && formatLocalDate(parsedDate) === date;
}

function formatDisplayDate(date: string) {
  const [year, month, day] = date.split('-');
  return `${year}/${month}/${day}`;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0,
  }).format(price);
}
