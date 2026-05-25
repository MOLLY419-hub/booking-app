import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ALL_CAMPS, useCamp } from '../contexts/CampContext';
import { supabase } from '../lib/supabase';
import type { BookingOrder } from '../types/database';

type RevenueMode = 'day' | 'tenDays' | 'month';

const today = formatLocalDate(new Date());
const thisMonth = today.slice(0, 7);

export function RevenuePage() {
  const { selectedCampId } = useCamp();
  const [mode, setMode] = useState<RevenueMode>('day');
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(thisMonth);
  const [orders, setOrders] = useState<BookingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const range = useMemo(() => getRange(mode, date, month), [date, mode, month]);

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
        total.totalAmount += Number(order.total_amount || 0);
        total.depositAmount += Number(order.deposit_amount || 0);
        total.confirmedDeposit += order.deposit_confirmed ? Number(order.deposit_amount || 0) : 0;
        total.balanceAmount += Number(order.balance_amount || 0);
        total.roomCount += Number(order.room_count || 0);
        return total;
      },
      {
        totalAmount: 0,
        depositAmount: 0,
        confirmedDeposit: 0,
        balanceAmount: 0,
        roomCount: 0,
      },
    );
  }, [orders]);

  function moveDate(days: number) {
    const next = parseLocalDate(date);
    next.setDate(next.getDate() + days);
    setDate(formatLocalDate(next));
  }

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Revenue</p>
          <h1>營收報表</h1>
        </div>
      </div>

      <div className="form-panel page-stack">
        <div className="segmented-control">
          <button className={mode === 'day' ? 'active' : ''} onClick={() => setMode('day')}>
            每日
          </button>
          <button className={mode === 'tenDays' ? 'active' : ''} onClick={() => setMode('tenDays')}>
            十天
          </button>
          <button className={mode === 'month' ? 'active' : ''} onClick={() => setMode('month')}>
            每月
          </button>
        </div>

        <div className="form-grid">
          {mode === 'month' ? (
            <label>
              選擇月份
              <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
            </label>
          ) : (
            <div className="date-control-panel revenue-date-control">
              <div className="date-control-bar">
                <span className="date-control-label">{mode === 'day' ? '查看日期' : '十天起始日'}</span>
                <button className="secondary-button" type="button" onClick={() => moveDate(mode === 'day' ? -1 : -10)}>
                  <ChevronLeft size={18} />
                  {mode === 'day' ? '前一天' : '前十天'}
                </button>
                <label className="date-control-input">
                  <input
                    type="date"
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                    onClick={(event) => {
                      (event.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
                    }}
                  />
                  <span>
                    <b>{formatDisplayDate(date)}</b>
                  </span>
                </label>
                <button className="secondary-button" type="button" onClick={() => moveDate(mode === 'day' ? 1 : 10)}>
                  {mode === 'day' ? '後一天' : '後十天'}
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          )}
          <div className="field-preview">
            <span>統計區間</span>
            <strong>
              {formatDisplayDateWithWeekday(range.start)} - {formatDisplayDateWithWeekday(range.end)}
            </strong>
          </div>
        </div>
      </div>

      <div className="metric-grid metric-grid-wide">
        <article className="metric metric-available">
          <span>訂單總額</span>
          <strong>{formatPrice(summary.totalAmount)}</strong>
        </article>
        <article className="metric">
          <span>已確認訂金</span>
          <strong>{formatPrice(summary.confirmedDeposit)}</strong>
        </article>
        <article className="metric">
          <span>訂金金額</span>
          <strong>{formatPrice(summary.depositAmount)}</strong>
        </article>
        <article className="metric">
          <span>尾款金額</span>
          <strong>{formatPrice(summary.balanceAmount)}</strong>
        </article>
        <article className="metric">
          <span>房間數 / 訂單數</span>
          <strong>
            {summary.roomCount} / {orders.length}
          </strong>
        </article>
      </div>

      <div className="table-panel">
        {error && <div className="form-error">{error}</div>}
        {loading ? (
          <div className="empty-state">載入中...</div>
        ) : orders.length === 0 ? (
          <div className="empty-state">這個區間沒有訂單</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>入住</th>
                  <th>退房</th>
                  <th>住客</th>
                  <th>房間數</th>
                  <th>總額</th>
                  <th>訂金</th>
                  <th>尾款</th>
                  <th>入帳</th>
                  <th>狀態</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td>{order.check_in_date}</td>
                    <td>{order.check_out_date}</td>
                    <td>
                      <strong>{order.guest_name}</strong>
                      <span className="subtext">{order.guest_phone || '未填電話'}</span>
                    </td>
                    <td>{order.room_count}</td>
                    <td>{formatPrice(order.total_amount)}</td>
                    <td>{formatPrice(order.deposit_amount)}</td>
                    <td>{formatPrice(order.balance_amount)}</td>
                    <td>{order.deposit_confirmed ? '已入帳' : '未確認'}</td>
                    <td>
                      <span className={`status status-${order.status}`}>{statusLabel(order.status)}</span>
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
  const labels = ['日', '一', '二', '三', '四', '五', '六'];
  return `週${labels[parseLocalDate(date).getDay()]}`;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0,
  }).format(price);
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: '未確認',
    awaiting_deposit_confirmation: '待對帳',
    confirmed: '已確認',
    checked_in: '已入住',
    checked_out: '已退房',
    cancelled: '已取消',
  };
  return labels[status] ?? status;
}
