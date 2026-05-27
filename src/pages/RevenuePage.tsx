import { useEffect, useMemo, useState } from 'react';
import { CuteDateNavigator } from '../components/CuteDatePicker';
import { ALL_CAMPS, useCamp } from '../contexts/CampContext';
import { supabase } from '../lib/supabase';
import type { BookingOrder } from '../types/database';

type RevenueMode = 'day' | 'tenDays' | 'month';
type RevenueFilterState = {
  mode: RevenueMode;
  date: string;
  month: string;
};

const today = formatLocalDate(new Date());
const thisMonth = today.slice(0, 7);
const REVENUE_FILTER_STORAGE_KEY = 'booking-app-revenue-filter';

export function RevenuePage() {
  const { camps, selectedCampId } = useCamp();
  const [savedFilter] = useState(() => getStoredRevenueFilter());
  const [mode, setMode] = useState<RevenueMode>(savedFilter.mode);
  const [date, setDate] = useState(savedFilter.date);
  const [month, setMonth] = useState(savedFilter.month);
  const [orders, setOrders] = useState<BookingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const range = useMemo(() => getRange(mode, date, month), [date, mode, month]);
  const campName =
    selectedCampId === ALL_CAMPS ? '全部營區' : camps.find((camp) => camp.id === selectedCampId)?.name ?? '目前營區';

  useEffect(() => {
    saveStoredRevenueFilter({ mode, date, month });
  }, [date, mode, month]);

  useEffect(() => {
    async function loadRevenue() {
      setLoading(true);
      setError('');

      let query = supabase
        .from('booking_orders')
        .select('*')
        .gte('check_in_date', range.start)
        .lte('check_in_date', range.end)
        .neq('status', 'cancelled')
        .order('check_in_date', { ascending: true });

      if (selectedCampId !== ALL_CAMPS) {
        query = query.eq('camp_id', selectedCampId);
      }

      const { data, error: loadError } = await query;

      if (loadError) {
        setError(loadError.message);
        setOrders([]);
      } else {
        setOrders(data ?? []);
      }
      setLoading(false);
    }

    loadRevenue();
  }, [range.end, range.start, selectedCampId]);

  const summary = useMemo(() => {
    return orders.reduce(
      (total, order) => {
        const deposit = Number(order.deposit_amount || 0);
        total.totalAmount += Number(order.total_amount || 0);
        total.depositAmount += deposit;
        total.confirmedDeposit += order.deposit_confirmed ? deposit : 0;
        total.balanceAmount += Number(order.balance_amount || 0);
        return total;
      },
      {
        totalAmount: 0,
        depositAmount: 0,
        confirmedDeposit: 0,
        balanceAmount: 0,
      },
    );
  }, [orders]);

  function moveDate(days: number) {
    const next = parseLocalDate(date);
    next.setDate(next.getDate() + days);
    setDate(formatLocalDate(next));
  }

  function moveMonth(months: number) {
    const [year, monthValue] = month.split('-').map(Number);
    const next = new Date(year, monthValue - 1 + months, 1);
    setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
  }

  return (
    <section className="page-stack revenue-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">REVENUE REPORT</p>
          <h1>營收報表</h1>
        </div>
      </div>

      <div className="form-panel revenue-filter-panel">
        <div className="segmented-control revenue-mode-tabs">
          <button type="button" className={mode === 'day' ? 'active' : ''} onClick={() => setMode('day')}>
            每日
          </button>
          <button type="button" className={mode === 'tenDays' ? 'active' : ''} onClick={() => setMode('tenDays')}>
            十天
          </button>
          <button type="button" className={mode === 'month' ? 'active' : ''} onClick={() => setMode('month')}>
            每月
          </button>
        </div>

        {mode === 'month' ? (
          <div className="revenue-month-control">
            <button className="secondary-button" type="button" onClick={() => moveMonth(-1)}>
              前一月
            </button>
            <label>
              查看月份
              <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
            </label>
            <button className="secondary-button" type="button" onClick={() => moveMonth(1)}>
              後一月
            </button>
          </div>
        ) : (
          <CuteDateNavigator
            value={date}
            onChange={setDate}
            onMove={moveDate}
            label="查看日期"
            previousLabel={mode === 'day' ? '前一天' : '前十天'}
            nextLabel={mode === 'day' ? '後一天' : '後十天'}
            previousDays={mode === 'day' ? -1 : -10}
            nextDays={mode === 'day' ? 1 : 10}
          />
        )}

        <div className="field-preview revenue-range-preview">
          <span>統計區間</span>
          <strong>
            {formatDisplayDateWithWeekday(range.start)} - {formatDisplayDateWithWeekday(range.end)}
          </strong>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      <section className="revenue-report-card">
        <div className="revenue-card-camp-pill">
          <span>目前營區</span>
          <strong>{campName}</strong>
        </div>

        <article className="revenue-total-card">
          <span>訂單總額</span>
          <strong>{loading ? '載入中...' : formatPrice(summary.totalAmount)}</strong>
        </article>

        <div className="revenue-breakdown-grid">
          <article className="revenue-mini-card">
            <span>尾款總額</span>
            <strong>{loading ? '-' : formatPrice(summary.balanceAmount)}</strong>
          </article>
          <article className="revenue-mini-card">
            <span>訂金金額</span>
            <strong>{loading ? '-' : formatPrice(summary.depositAmount)}</strong>
          </article>
          <article className="revenue-mini-card">
            <span>已確認訂金</span>
            <strong>{loading ? '-' : formatPrice(summary.confirmedDeposit)}</strong>
          </article>
        </div>
      </section>
    </section>
  );
}

function getRange(mode: RevenueMode, date: string, month: string) {
  if (mode === 'month') {
    const [year, monthValue] = month.split('-').map(Number);
    const start = new Date(year, monthValue - 1, 1);
    const end = new Date(year, monthValue, 0);
    return {
      start: formatLocalDate(start),
      end: formatLocalDate(end),
    };
  }

  const start = parseLocalDate(date);
  const end = parseLocalDate(date);
  if (mode === 'tenDays') {
    end.setDate(end.getDate() + 9);
  }

  return {
    start: formatLocalDate(start),
    end: formatLocalDate(end),
  };
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

function formatDisplayDateWithWeekday(date: string) {
  return `${formatDisplayDate(date)} ${formatWeekday(date)}`;
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
  }).format(price);
}

function getStoredRevenueFilter(): RevenueFilterState {
  const fallback = getDefaultRevenueFilter();

  if (typeof window === 'undefined') return fallback;

  try {
    const raw = window.localStorage.getItem(REVENUE_FILTER_STORAGE_KEY);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Partial<RevenueFilterState>;
    return {
      mode: isRevenueMode(parsed.mode) ? parsed.mode : fallback.mode,
      date: isDateValue(parsed.date) ? parsed.date : fallback.date,
      month: isMonthValue(parsed.month) ? parsed.month : fallback.month,
    };
  } catch {
    return fallback;
  }
}

function saveStoredRevenueFilter(filter: RevenueFilterState) {
  if (typeof window === 'undefined') return;

  window.localStorage.setItem(REVENUE_FILTER_STORAGE_KEY, JSON.stringify(filter));
}

function getDefaultRevenueFilter(): RevenueFilterState {
  return {
    mode: 'day',
    date: today,
    month: thisMonth,
  };
}

function isRevenueMode(value: unknown): value is RevenueMode {
  return value === 'day' || value === 'tenDays' || value === 'month';
}

function isDateValue(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isMonthValue(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value);
}
