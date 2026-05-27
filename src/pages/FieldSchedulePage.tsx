import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CuteDateNavigator } from '../components/CuteDatePicker';
import { ALL_CAMPS, useCamp } from '../contexts/CampContext';
import { useAuth } from '../contexts/AuthContext';
import { bookingOrderStatusClass, bookingOrderStatusLabel } from '../lib/bookingStatus';
import { supabase } from '../lib/supabase';
import type { BookingOrderWithBookings, BookingStatus, DailyHandoff, InvoiceStatus, Room } from '../types/database';

const today = formatLocalDate(new Date());

type ScheduleGroup = 'check_in' | 'staying';

export function FieldSchedulePage() {
  const { selectedCampId } = useCamp();
  const { role, user } = useAuth();
  const [date, setDate] = useState(today);
  const [orders, setOrders] = useState<BookingOrderWithBookings[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [handoffNote, setHandoffNote] = useState('');
  const [handoffError, setHandoffError] = useState('');
  const [savingHandoff, setSavingHandoff] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const canEditHandoff = role === 'admin' || role === 'staff';

  useEffect(() => {
    async function loadSchedule() {
      setLoading(true);
      setError('');

      let orderQuery = supabase
        .from('booking_orders')
        .select('*, bookings(*, rooms(id, camp_id, name, room_type, base_price))')
        .lte('check_in_date', date)
        .gte('check_out_date', date)
        .neq('status', 'cancelled')
          .order('check_in_date', { ascending: true });
      let roomQuery = supabase.from('rooms').select('*').eq('is_active', true);
      let handoffQuery = supabase.from('daily_handoffs').select('*').eq('date', date).limit(1);

      if (selectedCampId !== ALL_CAMPS) {
        orderQuery = orderQuery.eq('camp_id', selectedCampId);
        roomQuery = roomQuery.eq('camp_id', selectedCampId);
        handoffQuery = handoffQuery.eq('camp_id', selectedCampId);
      } else {
        handoffQuery = handoffQuery.is('camp_id', null);
      }

      const [orderResult, roomResult, handoffResult] = await Promise.all([
        orderQuery,
        roomQuery,
        handoffQuery,
      ]);

      if (orderResult.error) {
        setError(orderResult.error.message);
      } else if (roomResult.error) {
        setError(roomResult.error.message);
      } else {
        setOrders((orderResult.data as BookingOrderWithBookings[]) ?? []);
        setRooms(roomResult.data ?? []);
      }
      if (handoffResult.error) {
        console.error(handoffResult.error);
        setHandoffError(handoffResult.error.message);
        setHandoffNote('');
      } else {
        setHandoffError('');
        setHandoffNote(((handoffResult.data as DailyHandoff[]) ?? [])[0]?.note ?? '');
      }
      setLoading(false);
    }

    loadSchedule();
  }, [date, selectedCampId]);

  const activeRoomCount = rooms.length;
  const checkInOrders = orders.filter((order) => order.check_in_date === date);
  const stayingOrders = orders.filter((order) => order.check_in_date < date && order.check_out_date > date);
  const occupiedRoomCount = orders
    .filter((order) => order.check_in_date <= date && order.check_out_date > date)
    .reduce((sum, order) => sum + Number(order.room_count || 0), 0);
  const availableRoomCount = Math.max(activeRoomCount - occupiedRoomCount, 0);

  const roomTypeSummary = useMemo(() => {
    const counts = new Map<string, number>();
    orders
      .filter((order) => order.check_in_date <= date && order.check_out_date > date)
      .forEach((order) => {
        order.bookings.forEach((booking) => {
          const roomType = booking.rooms?.room_type || '未設定房型';
          counts.set(roomType, (counts.get(roomType) ?? 0) + 1);
        });
      });

    return Array.from(counts.entries()).map(([roomType, count]) => `${roomType} x ${count}`);
  }, [date, orders]);

  function moveDate(days: number) {
    const next = parseLocalDate(date);
    next.setDate(next.getDate() + days);
    setDate(formatLocalDate(next));
  }

  async function saveHandoff() {
    if (selectedCampId === ALL_CAMPS) {
      setHandoffError('請先選擇單一營區，再填寫交辦事項。');
      return;
    }

    setSavingHandoff(true);
    setHandoffError('');
    const { error: saveError } = await supabase.from('daily_handoffs').upsert(
      {
        camp_id: selectedCampId,
        date,
        note: handoffNote.trim() || null,
        updated_by: user?.id ?? null,
        created_by: user?.id ?? null,
      },
      { onConflict: 'camp_id,date' },
    );
    if (saveError) setHandoffError(saveError.message);
    setSavingHandoff(false);
  }

  return (
    <section className="page-stack field-schedule-page">
      <div className="page-header field-schedule-header">
        <div>
          <p className="eyebrow">{formatDisplayDate(date)} {formatWeekday(date)}</p>
          <h1>每日訂房表</h1>
        </div>
        <CuteDateNavigator value={date} onChange={setDate} onMove={moveDate} />
        {false && (
        <div className="date-control-panel field-date-control-panel">
          <div className="schedule-datebar date-control-bar">
          <span className="date-control-label">查看日期</span>
          <button className="secondary-button" onClick={() => moveDate(-1)}>
            <ChevronLeft size={18} />
            前一天
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
              <b>{formatSlashDate(date)}</b>
            </span>
          </label>
          <button className="secondary-button" onClick={() => moveDate(1)}>
            後一天
            <ChevronRight size={18} />
          </button>
          </div>
        </div>
        )}
        <Link className="secondary-button field-view-all-button" to="/bookings">
          查看全部
        </Link>
      </div>

      <div className="metric-grid metric-grid-wide field-summary-grid">
        <article className="metric">
          <span>今日入住</span>
          <strong>{checkInOrders.reduce((sum, order) => sum + Number(order.room_count || 0), 0)} 間</strong>
        </article>
        <article className="metric">
          <span>住宿中</span>
          <strong>{occupiedRoomCount} 間</strong>
        </article>
        <article className="metric metric-available">
          <span>剩餘空房</span>
          <strong>{availableRoomCount} 間</strong>
        </article>
        <article className="metric">
          <span>住房房型</span>
          <strong className="field-room-type-summary">
            {roomTypeSummary.length > 0
              ? roomTypeSummary.map((item, index) => (
                  <span className="field-room-type-line" key={item}>
                    {item}
                    {index < roomTypeSummary.length - 1 ? '、' : ''}
                  </span>
                ))
              : '-'}
          </strong>
        </article>
      </div>

      <DailyHandoffPanel
        canEdit={canEditHandoff}
        error={handoffError}
        note={handoffNote}
        onChange={setHandoffNote}
        onSave={saveHandoff}
        saving={savingHandoff}
        selectedCampId={selectedCampId}
      />

      <div className="table-panel">
        {error && <div className="form-error">{error}</div>}
        {loading ? (
          <div className="empty-state">載入中...</div>
        ) : orders.length === 0 ? (
          <div className="empty-state">這一天沒有訂房紀錄</div>
        ) : (
          <div className="field-schedule-list">
            <ScheduleSection title="今日入住" group="check_in" orders={checkInOrders} activeRoomCount={activeRoomCount} />
            <ScheduleSection title="住宿中" group="staying" orders={stayingOrders} activeRoomCount={activeRoomCount} />
          </div>
        )}
      </div>
    </section>
  );
}

function DailyHandoffPanel({
  canEdit,
  error,
  note,
  onChange,
  onSave,
  saving,
  selectedCampId,
}: {
  canEdit: boolean;
  error: string;
  note: string;
  onChange: (note: string) => void;
  onSave: () => void;
  saving: boolean;
  selectedCampId: string;
}) {
  return (
    <section className="daily-handoff-panel">
      <div>
        <strong>當日交辦事項</strong>
        {selectedCampId === ALL_CAMPS && <span>請選擇單一營區後填寫交辦事項</span>}
      </div>
      {error && <div className="form-error">{error}</div>}
      {canEdit ? (
        <div className="daily-handoff-editor">
          <textarea
            placeholder="例如：客人晚到、現場需協助、設備提醒"
            rows={3}
            value={note}
            onChange={(event) => onChange(event.target.value)}
          />
          <button className="primary-button" disabled={saving || selectedCampId === ALL_CAMPS} type="button" onClick={onSave}>
            {saving ? '儲存中...' : '儲存交辦'}
          </button>
        </div>
      ) : (
        <p>{note || '今日沒有交辦事項'}</p>
      )}
    </section>
  );
}

function ScheduleSection({
  title,
  group,
  orders,
  activeRoomCount,
}: {
  title: string;
  group: ScheduleGroup;
  orders: BookingOrderWithBookings[];
  activeRoomCount: number;
}) {
  return (
    <section className="field-schedule-section">
      <div className="panel-heading panel-heading-plain">
        <h2>{title}</h2>
        <span className="subtext">{orders.reduce((sum, order) => sum + Number(order.room_count || 0), 0)} 間</span>
      </div>
      {orders.length === 0 ? (
        <div className="empty-state compact-empty">沒有資料</div>
      ) : (
        <>
          <div className="mobile-card-list">
            {orders.map((order) => (
              <MobileScheduleCard activeRoomCount={activeRoomCount} key={`${group}-card-${order.id}`} order={order} />
            ))}
          </div>
          <div className="table-scroll">
          <table className="field-schedule-table">
            <thead>
              <tr>
                <th>住客</th>
                <th>電話</th>
                <th>房間</th>
                <th>房型</th>
                <th>晚數</th>
                <th>總額</th>
                <th>尾款</th>
                <th>發票</th>
                <th>狀態</th>
                <th>備註</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={`${group}-${order.id}`}>
                  <td>
                    <strong>{order.guest_name}</strong>
                  </td>
                  <td>{order.guest_phone || '-'}</td>
                  <td>
                    <strong>{order.room_count} 間</strong>
                  </td>
                  <td className="room-summary-cell">{summarizeRoomTypes(order, activeRoomCount)}</td>
                  <td>{getNightCount(order.check_in_date, order.check_out_date)}晚</td>
                  <td>{formatPrice(order.total_amount)}</td>
                  <td>{formatPrice(order.balance_amount)}</td>
                  <td className="field-invoice-cell">{renderInvoiceStatus(order)}</td>
                  <td>
                    <span className={`status ${bookingOrderStatusClass(order)}`}>{bookingOrderStatusLabel(order)}</span>
                  </td>
                  <td>{cleanNoteForField(order.note)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </section>
  );
}

function MobileScheduleCard({
  order,
  activeRoomCount,
}: {
  order: BookingOrderWithBookings;
  activeRoomCount: number;
}) {
  return (
    <article className="mobile-order-card">
      <div className="mobile-order-card-main">
        <div>
          <div className="mobile-order-card-guest">
            <strong>{order.guest_name}</strong>
            <span>{order.guest_phone || '未填電話'}</span>
          </div>
          <div className="mobile-order-card-money">
            <span>總額：{formatPrice(order.total_amount)}</span>
            <span>訂金：{formatPrice(order.deposit_amount)}</span>
            <span>尾款：{formatPrice(order.balance_amount)}</span>
          </div>
        </div>
        <div className="mobile-order-card-detail">
          <span>晚數：{getNightCount(order.check_in_date, order.check_out_date)} 晚</span>
          <span>房間：{order.room_count} 間</span>
          <span>房型：{renderRoomTypeSummary(order, activeRoomCount)}</span>
        </div>
        <div className="mobile-order-card-side">
          <span>發票</span>
          <div className="mobile-order-card-side-box field-invoice-cell">{renderInvoiceStatus(order)}</div>
          <span>狀態</span>
          <span className={`status mobile-card-status ${bookingOrderStatusClass(order)}`}>
            {bookingOrderStatusLabel(order)}
          </span>
        </div>
        <div className="mobile-order-card-note">訂單備註：{cleanNoteForField(order.note)}</div>
      </div>
    </article>
  );
}

function summarizeRoomTypes(order: BookingOrderWithBookings, activeRoomCount: number) {
  if (activeRoomCount > 0 && Number(order.room_count || 0) >= activeRoomCount) return '包場';

  return getRoomTypeSummaryParts(order).join('、');
}

function renderRoomTypeSummary(order: BookingOrderWithBookings, activeRoomCount: number) {
  if (activeRoomCount > 0 && Number(order.room_count || 0) >= activeRoomCount) {
    return <span className="room-type-line">包場</span>;
  }

  const parts = getRoomTypeSummaryParts(order);
  return (
    <span className="room-type-summary">
      {parts.map((part, index) => (
        <span className="room-type-line" key={part}>
          {part}
          {index < parts.length - 1 ? '、' : ''}
        </span>
      ))}
    </span>
  );
}

function getRoomTypeSummaryParts(order: BookingOrderWithBookings) {
  const counts = new Map<string, number>();
  order.bookings.forEach((booking) => {
    const roomType = booking.rooms?.room_type || '未設定房型';
    counts.set(roomType, (counts.get(roomType) ?? 0) + 1);
  });
  return Array.from(counts.entries()).map(([roomType, count]) => `${roomType} x ${count}`);
}

function cleanNoteForField(note: string | null) {
  if (!note) return '-';
  return stripPaymentRecords(note) || '-';
}

function stripPaymentRecords(note: string) {
  const markers = ['訂金付款紀錄：', '訂金付款紀錄', '付款紀錄：', '付款紀錄'];
  let cleanNote = note;
  markers.forEach((marker) => {
    const index = cleanNote.indexOf(marker);
    if (index >= 0) cleanNote = cleanNote.slice(0, index);
  });
  return cleanNote
    .split('\n')
    .filter((line) => !/第\s*\d+\s*筆\s*\/|末五碼|已對帳|待對帳/.test(line))
    .join('\n')
    .trim();
}

function invoiceText(order: BookingOrderWithBookings) {
  const normalizedStatus = normalizeInvoiceStatus(order.invoice_status);
  const label = invoiceStatusLabel(normalizedStatus);
  if (!order.invoice_note || normalizedStatus === 'none' || normalizedStatus === 'issued') return label;
  return `${label}：${order.invoice_note}`;
}

function renderInvoiceStatus(order: BookingOrderWithBookings) {
  const normalizedStatus = normalizeInvoiceStatus(order.invoice_status);
  return <span className={`invoice-badge invoice-badge-${normalizedStatus}`}>{invoiceText(order)}</span>;
}

function normalizeInvoiceStatus(status: string | null | undefined): InvoiceStatus {
  if (status === 'month_end' || status === 'onsite' || status === 'issued' || status === 'none') return status;
  if (status === 'not_issued') return 'none';
  return 'none';
}

function invoiceStatusLabel(status: InvoiceStatus) {
  const labels: Record<InvoiceStatus, string> = {
    none: '不需發票',
    month_end: '月底開立',
    onsite: '現場開立',
    issued: '已開發票',
  };
  return labels[status];
}

function statusLabel(status: BookingStatus) {
  const labels: Record<BookingStatus, string> = {
    pending: '未確認',
    awaiting_deposit_confirmation: '待對帳',
    confirmed: '已確認',
    checked_in: '已入住',
    checked_out: '已退房',
    cancelled: '已取消',
  };
  return labels[status] ?? status;
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
  return `${year}-${month}-${day}`;
}

function formatSlashDate(date: string) {
  const [year, month, day] = date.split('-');
  return `${year}/${month}/${day}`;
}

function formatWeekday(date: string) {
  const labels = ['日', '一', '二', '三', '四', '五', '六'];
  return `週${labels[parseLocalDate(date).getDay()]}`;
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
  }).format(Number(price || 0));
}
