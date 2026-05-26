import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ALL_CAMPS, useCamp } from '../contexts/CampContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import type { BookingOrderWithBookings, BookingStatus, DailyHandoff, InvoiceStatus, Room } from '../types/database';

const today = formatLocalDate(new Date());

export function DashboardPage() {
  const { selectedCampId } = useCamp();
  const { role, user } = useAuth();
  const [date, setDate] = useState(today);
  const [orders, setOrders] = useState<BookingOrderWithBookings[]>([]);
  const [checkoutOrders, setCheckoutOrders] = useState<BookingOrderWithBookings[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [handoffNote, setHandoffNote] = useState('');
  const [handoffError, setHandoffError] = useState('');
  const [savingHandoff, setSavingHandoff] = useState(false);
  const [loading, setLoading] = useState(true);
  const canEditHandoff = role === 'admin' || role === 'staff';

  useEffect(() => {
    async function loadOverview() {
      setLoading(true);

      let activeOrderQuery = supabase
        .from('booking_orders')
        .select('*, bookings(*, rooms(id, camp_id, name, room_type, base_price))')
        .lte('check_in_date', date)
        .gt('check_out_date', date)
        .neq('status', 'cancelled')
        .order('check_in_date', { ascending: true });
      let checkoutOrderQuery = supabase
        .from('booking_orders')
        .select('*, bookings(*, rooms(id, camp_id, name, room_type, base_price))')
        .eq('check_out_date', date)
        .neq('status', 'cancelled')
        .order('check_out_date', { ascending: true });
      let roomQuery = supabase.from('rooms').select('*').eq('is_active', true).order('name');
      let handoffQuery = supabase.from('daily_handoffs').select('*').eq('date', date).limit(1);

      if (selectedCampId !== ALL_CAMPS) {
        activeOrderQuery = activeOrderQuery.eq('camp_id', selectedCampId);
        checkoutOrderQuery = checkoutOrderQuery.eq('camp_id', selectedCampId);
        roomQuery = roomQuery.eq('camp_id', selectedCampId);
        handoffQuery = handoffQuery.eq('camp_id', selectedCampId);
      } else {
        handoffQuery = handoffQuery.is('camp_id', null);
      }

      const [activeOrderResult, checkoutOrderResult, roomResult, handoffResult] = await Promise.all([
        activeOrderQuery,
        checkoutOrderQuery,
        roomQuery,
        handoffQuery,
      ]);

      if (activeOrderResult.error) {
        console.error(activeOrderResult.error);
        setOrders([]);
      } else {
        setOrders((activeOrderResult.data as BookingOrderWithBookings[]) ?? []);
      }

      if (checkoutOrderResult.error) {
        console.error(checkoutOrderResult.error);
        setCheckoutOrders([]);
      } else {
        setCheckoutOrders((checkoutOrderResult.data as BookingOrderWithBookings[]) ?? []);
      }

      if (roomResult.error) {
        console.error(roomResult.error);
        setRooms([]);
      } else {
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

    loadOverview();
  }, [date, selectedCampId]);

  const totalRooms = rooms.length;
  const occupiedRooms = orders.reduce((sum, order) => sum + Number(order.room_count || 0), 0);
  const availableRooms = Math.max(totalRooms - occupiedRooms, 0);
  const checkingIn = orders
    .filter((order) => order.check_in_date === date)
    .reduce((sum, order) => sum + Number(order.room_count || 0), 0);
  const checkingOut = checkoutOrders.reduce((sum, order) => sum + Number(order.room_count || 0), 0);
  const occupancyRate = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0;
  const activeTotalAmount = orders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
  const activeDepositAmount = orders.reduce((sum, order) => sum + Number(order.deposit_amount || 0), 0);
  const activeBalanceAmount = orders.reduce((sum, order) => sum + Number(order.balance_amount || 0), 0);
  const roomTypeOverview = summarizeRoomTypeCounts(orders, totalRooms);

  const sortedOrders = useMemo(
    () =>
      [...orders].sort((a, b) => {
        const aType = summarizeRoomTypes(a, totalRooms);
        const bType = summarizeRoomTypes(b, totalRooms);
        return aType.localeCompare(bType, 'zh-Hant');
      }),
    [orders, totalRooms],
  );

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
    const { error } = await supabase.from('daily_handoffs').upsert(
      {
        camp_id: selectedCampId,
        date,
        note: handoffNote.trim() || null,
        updated_by: user?.id ?? null,
        created_by: user?.id ?? null,
      },
      { onConflict: 'camp_id,date' },
    );
    if (error) setHandoffError(error.message);
    setSavingHandoff(false);
  }

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">{formatDisplayDateWithWeekday(date)}</p>
          <h1>訂房總覽</h1>
        </div>
        <Link className="secondary-button" to="/bookings">
          查看全部
        </Link>
      </div>

      <div className="form-panel date-control-panel">
        <div className="date-control-bar">
          <span className="date-control-label">查看日期</span>
          <button className="secondary-button" type="button" onClick={() => moveDate(-1)}>
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
          <button className="secondary-button" type="button" onClick={() => moveDate(1)}>
            後一天
            <ChevronRight size={18} />
          </button>
        </div>
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

      <DashboardHeroCard
        activeBalanceAmount={activeBalanceAmount}
        activeDepositAmount={activeDepositAmount}
        activeTotalAmount={activeTotalAmount}
        availableRooms={availableRooms}
        checkingIn={checkingIn}
        checkingOut={checkingOut}
        occupiedRooms={occupiedRooms}
        occupancyRate={occupancyRate}
        roomTypeOverview={roomTypeOverview}
        totalRooms={totalRooms}
      />

      <div className="table-panel">
        <div className="panel-heading">
          <h2>當日住房</h2>
        </div>
        {loading ? (
          <div className="empty-state">載入中...</div>
        ) : sortedOrders.length === 0 ? (
          <div className="empty-state">當日沒有住房資料</div>
        ) : (
          <>
            <div className="mobile-card-list">
              {sortedOrders.map((order) => (
                <MobileOverviewCard activeRoomCount={totalRooms} key={order.id} order={order} />
              ))}
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>房型</th>
                    <th>尾款</th>
                    <th>住客</th>
                    <th>入住</th>
                    <th>退房</th>
                    <th>發票</th>
                    <th>狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedOrders.map((order) => (
                    <tr key={order.id}>
                      <td>{summarizeRoomTypes(order, totalRooms)}</td>
                      <td>{formatPrice(order.balance_amount)}</td>
                      <td>{order.guest_name}</td>
                      <td>{order.check_in_date}</td>
                      <td>{order.check_out_date}</td>
                      <td>{renderInvoiceStatus(order)}</td>
                      <td>
                        <span className={`status status-${order.status}`}>{statusLabel(order.status)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function DashboardHeroCard({
  activeBalanceAmount,
  activeDepositAmount,
  activeTotalAmount,
  availableRooms,
  checkingIn,
  checkingOut,
  occupiedRooms,
  occupancyRate,
  roomTypeOverview,
  totalRooms,
}: {
  activeBalanceAmount: number;
  activeDepositAmount: number;
  activeTotalAmount: number;
  availableRooms: number;
  checkingIn: number;
  checkingOut: number;
  occupiedRooms: number;
  occupancyRate: number;
  roomTypeOverview: string;
  totalRooms: number;
}) {
  return (
    <section className="dashboard-hero-card">
      <div className="dashboard-hero-main">
        <div className="dashboard-hero-icon">
          <CalendarCheck size={24} />
        </div>
        <span className="dashboard-hero-badge">{occupancyRate}%</span>
        <div>
          <p>當日營運總覽</p>
          <h2>剩餘空房 {availableRooms} 間</h2>
        </div>
        <div className="dashboard-hero-stats">
          <div>
            <span>總房數</span>
            <strong>{totalRooms}</strong>
          </div>
          <div>
            <span>已占用</span>
            <strong>{occupiedRooms}</strong>
          </div>
          <div>
            <span>今日入住</span>
            <strong>{checkingIn}</strong>
          </div>
          <div>
            <span>今日退房</span>
            <strong>{checkingOut}</strong>
          </div>
        </div>
        <div className="dashboard-progress" aria-label="當日占用率">
          <span style={{ width: `${Math.min(occupancyRate, 100)}%` }} />
        </div>
        <div className="dashboard-hero-foot">
          <span>已收 {formatPrice(activeDepositAmount)}</span>
          <span>尾款 {formatPrice(activeBalanceAmount)}</span>
          <span>總額 {formatPrice(activeTotalAmount)}</span>
        </div>
      </div>
      <div className="dashboard-hero-side">
        <span>住房房型</span>
        <strong>{roomTypeOverview || '尚無住房'}</strong>
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

function MobileOverviewCard({
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
          <div className="mobile-order-card-side-box">{renderInvoiceStatus(order)}</div>
          <span>狀態</span>
          <span className={`status mobile-card-status status-${order.status}`}>{statusLabel(order.status)}</span>
        </div>
        <div className="mobile-order-card-note">訂單備註：{cleanNoteForDisplay(order.note)}</div>
      </div>
    </article>
  );
}

function summarizeRoomTypes(order: BookingOrderWithBookings, activeRoomCount: number) {
  if (activeRoomCount > 0 && Number(order.room_count || 0) >= activeRoomCount) return '包場';

  return getRoomTypeSummaryParts(order).join('、') || '-';
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

function summarizeRoomTypeCounts(orders: BookingOrderWithBookings[], activeRoomCount: number) {
  const counts = new Map<string, number>();
  orders.forEach((order) => {
    if (activeRoomCount > 0 && Number(order.room_count || 0) >= activeRoomCount) {
      counts.set('包場', (counts.get('包場') ?? 0) + 1);
      return;
    }

    getRoomTypeSummaryParts(order).forEach((part) => {
      const [roomType, countText] = part.split(' x ');
      counts.set(roomType, (counts.get(roomType) ?? 0) + Number(countText || 1));
    });
  });

  return Array.from(counts.entries())
    .map(([roomType, count]) => `${roomType} ${count}`)
    .join('、');
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

function invoiceStatusLabel(status: InvoiceStatus) {
  const labels: Record<InvoiceStatus, string> = {
    none: '不需發票',
    month_end: '月底開立',
    onsite: '現場開立',
    issued: '已開發票',
  };
  return labels[status];
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

function formatDisplayDateWithWeekday(date: string) {
  return `${date} ${formatWeekday(date)}`;
}

function formatSlashDate(date: string) {
  const [year, month, day] = date.split('-');
  return `${year}/${month}/${day}`;
}

function formatWeekday(date: string) {
  const labels = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
  return labels[parseLocalDate(date).getDay()];
}

function getNightCount(checkInDate: string, checkOutDate: string) {
  const checkIn = parseLocalDate(checkInDate).getTime();
  const checkOut = parseLocalDate(checkOutDate).getTime();
  const days = Math.round((checkOut - checkIn) / 86400000);
  return Math.max(days, 1);
}

function cleanNoteForDisplay(note: string | null | undefined) {
  if (!note) return '-';
  return stripPaymentRecords(note.split('閮?隞狡蝝??')[0]) || '-';
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

function formatPrice(price?: number) {
  if (price === undefined || price === null) return '-';
  return new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0,
  }).format(price);
}
