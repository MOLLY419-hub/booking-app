import { Check, Clipboard, Edit3, Search, Trash2, X } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ALL_CAMPS, useCamp } from '../contexts/CampContext';
import { bookingOrderStatusClass, bookingOrderStatusLabel } from '../lib/bookingStatus';
import { createClientId } from '../lib/id';
import { getRoomTypeClass, getRoomTypeLabel, ROOM_TYPE_LEGEND, sortRoomsByDisplayOrder } from '../lib/rooms';
import { supabase } from '../lib/supabase';
import type {
  BookingOrderWithBookings,
  BookingStatus,
  InvoiceStatus,
  PriceCalendar,
  PriceRule,
  RateCategory,
  Room,
} from '../types/database';

const DEFAULT_SMALL_PET_FEE = 300;
const DEFAULT_LARGE_PET_FEE = 500;

type OrderEditForm = {
  guest_name: string;
  guest_phone: string;
  check_in_date: string;
  check_out_date: string;
  discount_amount: number | '';
  small_pet_count: number | '';
  large_pet_count: number | '';
  small_pet_fee_per_night: number | '';
  large_pet_fee_per_night: number | '';
  cancellation_postponement: boolean;
  invoice_status: InvoiceStatus;
  invoice_note: string;
  note: string;
};

type DepositPayment = {
  id: string;
  paid_date: string;
  amount: number | '';
  last5: string;
  confirmed: boolean;
  note: string;
};

export function BookingListPage() {
  const { role, user } = useAuth();
  const { selectedCampId } = useCamp();
  const [orders, setOrders] = useState<BookingOrderWithBookings[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeRoomCount, setActiveRoomCount] = useState(0);
  const [priceRules, setPriceRules] = useState<PriceRule[]>([]);
  const [priceCalendar, setPriceCalendar] = useState<PriceCalendar[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
const [editingOrder, setEditingOrder] = useState<BookingOrderWithBookings | null>(null);
  const [editForm, setEditForm] = useState<OrderEditForm | null>(null);
  const [editDepositPayments, setEditDepositPayments] = useState<DepositPayment[]>([]);
  const [editSelectedRoomIds, setEditSelectedRoomIds] = useState<string[]>([]);
  const [editBookedRoomIds, setEditBookedRoomIds] = useState<Set<string>>(new Set());
  const [editRoomTypeFilter, setEditRoomTypeFilter] = useState('all');
  const [loadingEditAvailability, setLoadingEditAvailability] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [editCompletionMessage, setEditCompletionMessage] = useState('');
  const [editCompletionCopyError, setEditCompletionCopyError] = useState('');
  const [editCompletionCopied, setEditCompletionCopied] = useState(false);
  const canEdit = role === 'admin' || role === 'staff';

  useEffect(() => {
    loadOrders();
  }, [selectedCampId]);

  async function loadOrders() {
    setLoading(true);
    setError('');

    let orderQuery = supabase
        .from('booking_orders')
        .select('*, bookings(*, rooms(id, camp_id, name, room_type, base_price))')
        .order('check_in_date', { ascending: false });
    let roomQuery = supabase.from('rooms').select('*').eq('is_active', true).order('name');
    let roomCountQuery = supabase.from('rooms').select('id', { count: 'exact', head: true }).eq('is_active', true);
    let calendarQuery = supabase.from('price_calendar').select('*');

    if (selectedCampId !== ALL_CAMPS) {
      orderQuery = orderQuery.eq('camp_id', selectedCampId);
      roomQuery = roomQuery.eq('camp_id', selectedCampId);
      roomCountQuery = roomCountQuery.eq('camp_id', selectedCampId);
      calendarQuery = calendarQuery.eq('camp_id', selectedCampId);
    }

    const [orderResult, roomResult, roomCountResult, ruleResult, calendarResult] = await Promise.all([
      orderQuery,
      roomQuery,
      roomCountQuery,
      supabase.from('price_rules').select('*'),
      calendarQuery,
    ]);

    if (orderResult.error) {
      setError(orderResult.error.message);
    } else if (roomResult.error) {
      setError(roomResult.error.message);
    } else if (roomCountResult.error) {
      setError(roomCountResult.error.message);
    } else if (ruleResult.error) {
      setError(ruleResult.error.message);
    } else if (calendarResult.error) {
      setError(calendarResult.error.message);
    } else {
      setOrders((orderResult.data as BookingOrderWithBookings[]) ?? []);
      setRooms(sortRoomsByDisplayOrder(roomResult.data ?? []));
      setActiveRoomCount(roomCountResult.count ?? 0);
      setPriceRules(ruleResult.data ?? []);
      setPriceCalendar(calendarResult.data ?? []);
    }
    setLoading(false);
  }

  function openOrderEditor(order: BookingOrderWithBookings) {
    const parsedNote = splitOrderNoteAndPayments(
      order.note ?? '',
      Number(order.deposit_amount || 0),
      order.deposit_payment_last5,
      order.deposit_confirmed,
    );
    const originalStayDates = datesBetween(order.check_in_date, order.check_out_date);
    const originalRackTotal = calculateOrderTotal(order, originalStayDates, priceRules, priceCalendar);
    const originalDiscount = Math.max(originalRackTotal - Number(order.total_amount || 0), 0);
    setEditingOrder(order);
    setEditSelectedRoomIds(order.bookings.map((booking) => booking.room_id));
    setEditBookedRoomIds(new Set());
    setEditRoomTypeFilter('all');
    setEditForm({
      guest_name: order.guest_name,
      guest_phone: order.guest_phone ?? '',
      check_in_date: order.check_in_date,
      check_out_date: order.check_out_date,
      discount_amount: originalDiscount > 0 ? originalDiscount : '',
      small_pet_count: Number(order.small_pet_count || 0) || '',
      large_pet_count: Number(order.large_pet_count || 0) || '',
      small_pet_fee_per_night: Number(order.small_pet_fee_per_night || DEFAULT_SMALL_PET_FEE),
      large_pet_fee_per_night: Number(order.large_pet_fee_per_night || DEFAULT_LARGE_PET_FEE),
      cancellation_postponement: order.cancellation_postponement ?? false,
      invoice_status: normalizeInvoiceStatus(order.invoice_status),
      invoice_note: order.invoice_note ?? '',
      note: parsedNote.baseNote,
    });
    setEditDepositPayments(parsedNote.payments);
    setError('');
  }

  function updateEditForm<K extends keyof OrderEditForm>(key: K, value: OrderEditForm[K]) {
    setEditForm((current) => (current ? { ...current, [key]: value } : current));
  }

  function addEditDepositPayment() {
    setEditDepositPayments((current) => [
      ...current,
      { id: createClientId(), paid_date: formatLocalDate(new Date()), amount: '', last5: '', confirmed: false, note: '' },
    ]);
  }

  function removeEditDepositPayment(id: string) {
    setEditDepositPayments((current) =>
      current.length === 1
        ? [{ id: createClientId(), paid_date: formatLocalDate(new Date()), amount: '', last5: '', confirmed: false, note: '' }]
        : current.filter((payment) => payment.id !== id),
    );
  }

  function updateEditDepositPayment<K extends keyof DepositPayment>(id: string, key: K, value: DepositPayment[K]) {
    setEditDepositPayments((current) =>
      current.map((payment) => (payment.id === id ? { ...payment, [key]: value } : payment)),
    );
  }

  function toggleEditRoom(roomId: string) {
    if (editBookedRoomIds.has(roomId)) return;
    setEditSelectedRoomIds((current) =>
      current.includes(roomId) ? current.filter((id) => id !== roomId) : [...current, roomId],
    );
  }

  async function saveOrder(event: FormEvent) {
    event.preventDefault();
    if (!editingOrder || !editForm) return;

    setSavingOrder(true);
    setError('');

    try {
      if (editForm.check_out_date <= editForm.check_in_date) {
        throw new Error('退房日期必須晚於入住日期');
      }
      if (editSelectedRooms.length === 0) {
        throw new Error('請至少保留一間房間');
      }
      if (editSelectedRoomIds.some((roomId) => editBookedRoomIds.has(roomId))) {
        throw new Error('已選房間包含被其他訂單預訂的房間，請重新選擇');
      }

      const activeDepositPayments = editDepositPayments.filter(isActiveDepositPayment);
      const invalidLast5 = activeDepositPayments.find((payment) => payment.last5.trim() && !/^\d{5}$/.test(payment.last5.trim()));
      if (invalidLast5) {
        throw new Error('每筆訂金付款末五碼請輸入 5 位數字，或留空');
      }
      const totalDepositAmount = activeDepositPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
      const latestDepositLast5 = [...activeDepositPayments]
        .reverse()
        .find((payment) => payment.last5.trim().length === 5)
        ?.last5.trim();
      const orderNote = buildOrderNote(editForm.note, activeDepositPayments);
      const latestActivePayment = [...activeDepositPayments].reverse()[0];

      const roomIds = editSelectedRoomIds;
      if (roomIds.length > 0) {
        const { data: conflicts, error: conflictError } = await supabase
          .from('bookings')
          .select('id, room_id')
          .in('room_id', roomIds)
          .lt('check_in_date', editForm.check_out_date)
          .gt('check_out_date', editForm.check_in_date)
          .neq('status', 'cancelled')
          .neq('order_id', editingOrder.id);

        if (conflictError) throw conflictError;
        if ((conflicts ?? []).length > 0) {
          throw new Error('修改後的日期會與其他訂單重複，請先確認空房');
        }
      }

      const nextStatus: BookingStatus = getStatusFromLatestPayment(latestActivePayment);
      const nextStayDates = datesBetween(editForm.check_in_date, editForm.check_out_date);
      const nextRackTotal = calculateRoomsTotal(editSelectedRooms, nextStayDates, priceRules, priceCalendar);
      const nextSmallPetCount =
        editForm.small_pet_count === '' ? 0 : Math.max(Number(editForm.small_pet_count || 0), 0);
      const nextLargePetCount =
        editForm.large_pet_count === '' ? 0 : Math.max(Number(editForm.large_pet_count || 0), 0);
      const nextSmallPetFeePerNight =
        editForm.small_pet_fee_per_night === ''
          ? DEFAULT_SMALL_PET_FEE
          : Math.max(Number(editForm.small_pet_fee_per_night || 0), 0);
      const nextLargePetFeePerNight =
        editForm.large_pet_fee_per_night === ''
          ? DEFAULT_LARGE_PET_FEE
          : Math.max(Number(editForm.large_pet_fee_per_night || 0), 0);
      const nextPetCleaningFee =
        nextStayDates.length *
        (nextSmallPetCount * nextSmallPetFeePerNight + nextLargePetCount * nextLargePetFeePerNight);
      const nextDiscount = editForm.discount_amount === '' ? 0 : Math.max(Number(editForm.discount_amount || 0), 0);
      const nextTotal = Math.max(nextRackTotal + nextPetCleaningFee - nextDiscount, 0);
      const nextBalance = Math.max(nextTotal - totalDepositAmount, 0);
      const nextRoomSummary = summarizeRooms(editSelectedRooms, activeRoomCount);

      const { error: orderError } = await supabase
        .from('booking_orders')
        .update({
          guest_name: editForm.guest_name,
          guest_phone: editForm.guest_phone || null,
          check_in_date: editForm.check_in_date,
          check_out_date: editForm.check_out_date,
          room_count: editSelectedRooms.length,
          small_pet_count: nextSmallPetCount,
          large_pet_count: nextLargePetCount,
          small_pet_fee_per_night: nextSmallPetFeePerNight,
          large_pet_fee_per_night: nextLargePetFeePerNight,
          total_amount: nextTotal,
          deposit_amount: totalDepositAmount,
          balance_amount: nextBalance,
          deposit_payment_last5: latestDepositLast5 || null,
          deposit_confirmed: latestActivePayment?.confirmed ?? false,
          deposit_confirmed_at: latestActivePayment?.confirmed ? new Date().toISOString() : null,
          cancellation_postponement: editForm.cancellation_postponement,
          invoice_status: editForm.invoice_status,
          invoice_note: editForm.invoice_note || null,
          status: nextStatus,
          note: orderNote || null,
          updated_by: user?.id ?? null,
        })
        .eq('id', editingOrder.id);

      if (orderError) throw orderError;

      const { data: existingBookings, error: existingBookingsError } = await supabase
        .from('bookings')
        .select('id, room_id')
        .eq('order_id', editingOrder.id);
      if (existingBookingsError) throw existingBookingsError;

      const selectedRoomIdSet = new Set(editSelectedRooms.map((room) => room.id));
      const existingRoomIds = new Set((existingBookings ?? []).map((booking) => booking.room_id));
      const removedRoomIds = [...existingRoomIds].filter((roomId) => !selectedRoomIdSet.has(roomId));

      await Promise.all(
        editSelectedRooms.map(async (room) => {
          const bookingPayload = {
            guest_name: editForm.guest_name,
            guest_phone: editForm.guest_phone || null,
            company_contact: null,
            check_in_date: editForm.check_in_date,
            check_out_date: editForm.check_out_date,
            room_price: calculateRoomStayTotal(room, nextStayDates, priceRules, priceCalendar),
            status: nextStatus,
            note: orderNote || null,
            updated_by: user?.id ?? null,
          };

          if (existingRoomIds.has(room.id)) {
            const { error: updateBookingError } = await supabase
              .from('bookings')
              .update(bookingPayload)
              .eq('order_id', editingOrder.id)
              .eq('room_id', room.id);
            if (updateBookingError) throw updateBookingError;
            return;
          }

          const { error: insertBookingError } = await supabase.from('bookings').insert({
            ...bookingPayload,
            order_id: editingOrder.id,
            room_id: room.id,
            created_by: user?.id ?? null,
          });
          if (insertBookingError) throw insertBookingError;
        }),
      );

      if (removedRoomIds.length > 0) {
        const { error: deleteBookingError } = await supabase
          .from('bookings')
          .delete()
          .eq('order_id', editingOrder.id)
          .in('room_id', removedRoomIds);
        if (deleteBookingError) throw deleteBookingError;
      }

      setEditingOrder(null);
      setEditForm(null);
      setEditDepositPayments([]);
      setEditSelectedRoomIds([]);
      setEditBookedRoomIds(new Set());
      await loadOrders();
      setEditCompletionMessage(
        buildEditCompletionMessage({
          checkInDate: editForm.check_in_date,
          checkOutDate: editForm.check_out_date,
          guestName: editForm.guest_name,
          guestPhone: editForm.guest_phone,
          rooms: nextRoomSummary,
          totalAmount: nextTotal,
        }),
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '儲存訂單失敗');
    } finally {
      setSavingOrder(false);
    }
  }

  async function copyEditCompletionMessage() {
    setEditCompletionCopyError('');
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(editCompletionMessage);
      } else {
        copyTextWithFallback(editCompletionMessage);
      }
      setEditCompletionCopied(true);
      window.setTimeout(() => setEditCompletionCopied(false), 1600);
    } catch {
      try {
        copyTextWithFallback(editCompletionMessage);
        setEditCompletionCopied(true);
        window.setTimeout(() => setEditCompletionCopied(false), 1600);
      } catch {
        setEditCompletionCopyError('瀏覽器暫時不允許自動複製，請直接選取下方文字複製。');
      }
    }
  }

  async function deleteOrder(order: BookingOrderWithBookings) {
    const confirmed = window.confirm(`確定要刪除 ${order.guest_name} 的訂單嗎？此動作會移除這筆訂單與房間明細。`);
    if (!confirmed) return;

    setError('');

    const { error: deleteError } = await supabase.rpc('delete_booking_order', { target_order_id: order.id });
    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    await loadOrders();
  }

  const filteredOrders = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return orders;
    return orders.filter((order) => {
      const roomTypes = summarizeRoomTypes(order, activeRoomCount);
      return [
        order.guest_name,
        order.guest_phone,
        cleanNoteForDisplay(order.note),
        roomTypes,
        ...getOrderDateSearchValues(order),
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalized));
    });
  }, [activeRoomCount, orders, query]);

  const editStayDates = useMemo(
    () => (editForm ? datesBetween(editForm.check_in_date, editForm.check_out_date) : []),
    [editForm?.check_in_date, editForm?.check_out_date],
  );
  const visibleEditRooms = useMemo(
    () => rooms.filter((room) => editRoomTypeFilter === 'all' || getRoomTypeLabel(room) === editRoomTypeFilter),
    [rooms, editRoomTypeFilter],
  );
  const editSelectedRooms = useMemo(
    () => rooms.filter((room) => editSelectedRoomIds.includes(room.id)),
    [rooms, editSelectedRoomIds],
  );
  const editRackTotalAmount = useMemo(
    () => calculateRoomsTotal(editSelectedRooms, editStayDates, priceRules, priceCalendar),
    [editSelectedRooms, editStayDates, priceRules, priceCalendar],
  );
  const editSmallPetCount =
    editForm?.small_pet_count === '' ? 0 : Math.max(Number(editForm?.small_pet_count || 0), 0);
  const editLargePetCount =
    editForm?.large_pet_count === '' ? 0 : Math.max(Number(editForm?.large_pet_count || 0), 0);
  const editSmallPetFeePerNight =
    editForm?.small_pet_fee_per_night === ''
      ? DEFAULT_SMALL_PET_FEE
      : Math.max(Number(editForm?.small_pet_fee_per_night || 0), 0);
  const editLargePetFeePerNight =
    editForm?.large_pet_fee_per_night === ''
      ? DEFAULT_LARGE_PET_FEE
      : Math.max(Number(editForm?.large_pet_fee_per_night || 0), 0);
  const editPetCleaningFee =
    editStayDates.length *
    (editSmallPetCount * editSmallPetFeePerNight + editLargePetCount * editLargePetFeePerNight);
  const editDiscountAmount = editForm?.discount_amount === '' ? 0 : Math.max(Number(editForm?.discount_amount || 0), 0);
  const editTotalAmount = Math.max(editRackTotalAmount + editPetCleaningFee - editDiscountAmount, 0);
  const editDepositTotalAmount = editDepositPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const editBalanceAmount = Math.max(editTotalAmount - editDepositTotalAmount, 0);

  useEffect(() => {
    async function loadEditAvailability() {
      if (!editingOrder || !editForm || editForm.check_out_date <= editForm.check_in_date) {
        setEditBookedRoomIds(new Set());
        return;
      }

      setLoadingEditAvailability(true);
      const roomIds = rooms.map((room) => room.id);
      if (roomIds.length === 0) {
        setEditBookedRoomIds(new Set());
        setLoadingEditAvailability(false);
        return;
      }

      const { data, error: availabilityError } = await supabase
        .from('bookings')
        .select('room_id')
        .in('room_id', roomIds)
        .lt('check_in_date', editForm.check_out_date)
        .gt('check_out_date', editForm.check_in_date)
        .neq('status', 'cancelled')
        .neq('order_id', editingOrder.id);

      if (availabilityError) {
        setError(availabilityError.message);
      } else {
        const bookedIds = new Set((data ?? []).map((booking) => booking.room_id));
        setEditBookedRoomIds(bookedIds);
        setEditSelectedRoomIds((current) => current.filter((roomId) => !bookedIds.has(roomId)));
      }
      setLoadingEditAvailability(false);
    }

    loadEditAvailability();
  }, [editingOrder?.id, editForm?.check_in_date, editForm?.check_out_date]);

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Booking orders</p>
          <h1>訂房列表</h1>
        </div>
        {canEdit && (
          <Link className="primary-button" to="/bookings/new">
            新增訂房
          </Link>
        )}
      </div>

      <div className="toolbar">
        <Search size={18} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜尋住客、電話、日期、備註或房型"
        />
      </div>

      <div className="table-panel">
        {error && <div className="form-error">{error}</div>}
        {loading ? (
          <div className="empty-state">載入中...</div>
        ) : filteredOrders.length === 0 ? (
          <div className="empty-state">沒有符合條件的訂單</div>
        ) : (
          <>
            <div className="mobile-card-list">
              {filteredOrders.map((order) => (
                <MobileBookingCard
                  activeRoomCount={activeRoomCount}
                  canEdit={canEdit}
                  key={`booking-card-${order.id}`}
                  onDelete={deleteOrder}
                  onEdit={openOrderEditor}
                  order={order}
                />
              ))}
            </div>
            <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>入住</th>
                  <th>退房</th>
                  <th>住客</th>
                  <th>房間數</th>
                  <th>房型</th>
                  <th>總額</th>
                  <th>訂金</th>
                  <th>尾款</th>
                  <th>末五碼</th>
                  <th>入帳</th>
                  <th>發票</th>
                  <th>取消延期</th>
                  <th>備註</th>
                  <th>狀態</th>
                  {canEdit && <th>操作</th>}
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => (
                  <tr key={order.id}>
                    <td>{formatCompactDate(order.check_in_date)}</td>
                    <td>{formatCompactDate(order.check_out_date)}</td>
                    <td>
                      <strong>{order.guest_name}</strong>
                      <span className="subtext">{order.guest_phone || '未填電話'}</span>
                    </td>
                    <td>
                      <strong>{order.room_count} 間</strong>
                    </td>
                    <td className="room-summary-cell">{renderRoomTypeSummary(order, activeRoomCount)}</td>
                    <td>{formatPrice(order.total_amount)}</td>
                    <td>{formatPrice(order.deposit_amount)}</td>
                    <td>{formatPrice(order.balance_amount)}</td>
                    <td>{order.deposit_payment_last5 || '-'}</td>
                    <td>{order.deposit_confirmed ? '已入帳' : '未確認'}</td>
                    <td>{renderInvoiceStatus(normalizeInvoiceStatus(order.invoice_status))}</td>
                    <td>{order.cancellation_postponement ? '需要處理' : '-'}</td>
                    <td>{cleanNoteForDisplay(order.note)}</td>
                    <td>
                      <span className={`status ${bookingOrderStatusClass(order)}`}>{bookingOrderStatusLabel(order)}</span>
                    </td>
                    {canEdit && (
                      <td>
                        <div className="inline-actions">
                          <button className="secondary-button" onClick={() => openOrderEditor(order)}>
                            <Edit3 size={16} />
                            修改訂單
                          </button>
                          <button className="danger-button" onClick={() => deleteOrder(order)}>
                            <Trash2 size={16} />
                            刪除
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}
      </div>

      {editingOrder && editForm && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal">
            <div className="modal-header">
              <div>
                <p className="eyebrow">Edit order</p>
                <h2>修改訂單</h2>
              </div>
              <button className="icon-button" onClick={() => setEditingOrder(null)} title="關閉">
                <X size={18} />
              </button>
            </div>
            <form className="form-grid" onSubmit={saveOrder}>
              <label>
                住客姓名
                <input
                  value={editForm.guest_name}
                  onChange={(event) => updateEditForm('guest_name', event.target.value)}
                  required
                />
              </label>
              <label>
                住客電話
                <input value={editForm.guest_phone} onChange={(event) => updateEditForm('guest_phone', event.target.value)} />
              </label>
              <label>
                入住日期
                <input
                  type="date"
                  value={editForm.check_in_date}
                  onChange={(event) => updateEditForm('check_in_date', event.target.value)}
                  required
                />
              </label>
              <label>
                退房日期
                <input
                  type="date"
                  value={editForm.check_out_date}
                  onChange={(event) => updateEditForm('check_out_date', event.target.value)}
                  required
                />
              </label>
              <label className="wide">
                訂單備註
                <input value={editForm.note} onChange={(event) => updateEditForm('note', event.target.value)} />
              </label>
              <section className="wide subsection">
                <div className="panel-heading panel-heading-plain">
                  <h2>修改房型</h2>
                  <span className="subtext">
                    已選 {editSelectedRooms.length} 間{loadingEditAvailability ? '，查詢空房中...' : ''}
                  </span>
                </div>
                <div className="room-type-legend room-type-legend-compact">
                  <button
                    className={`legend-chip legend-filter ${editRoomTypeFilter === 'all' ? 'active' : ''}`}
                    type="button"
                    onClick={() => setEditRoomTypeFilter('all')}
                  >
                    全部
                  </button>
                  {ROOM_TYPE_LEGEND.map((item) => (
                    <button
                      className={`legend-chip legend-filter ${item.className} ${
                        editRoomTypeFilter === item.label ? 'active' : ''
                      }`}
                      key={item.label}
                      type="button"
                      onClick={() => setEditRoomTypeFilter(item.label)}
                    >
                      {item.label}
                    </button>
                  ))}
                  <span className="legend-chip legend-booked">已被其他訂單預訂</span>
                </div>
                <div className="room-pick-grid">
                  {visibleEditRooms.map((room) => {
                    const isBooked = editBookedRoomIds.has(room.id);
                    const roomType = getRoomTypeLabel(room);
                    const roomTypeClass = getRoomTypeClass(roomType);
                    const firstNightPrice = editForm
                      ? getRoomNightPrice(room, editForm.check_in_date, priceRules, priceCalendar)
                      : Number(room.base_price || 0);
                    const stayTotal = calculateRoomStayTotal(room, editStayDates, priceRules, priceCalendar);
                    return (
                      <label className={`room-pick ${isBooked ? 'room-pick-disabled' : roomTypeClass}`} key={room.id}>
                        <input
                          type="checkbox"
                          checked={editSelectedRoomIds.includes(room.id)}
                          disabled={isBooked}
                          onChange={() => toggleEditRoom(room.id)}
                        />
                        <span>
                          <strong>{roomType}</strong>
                          <small>入住日 {formatPrice(firstNightPrice)}</small>
                          <small>{isBooked ? '此區間已被其他訂單預訂' : `${editStayDates.length} 晚合計 ${formatPrice(stayTotal)}`}</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>
              <section className="wide subsection">
                <div className="panel-heading panel-heading-plain">
                  <h2>訂金付款紀錄</h2>
                  <span className="subtext">可逐筆登記追加訂金，系統會自動加總</span>
                </div>
                <div className="deposit-payment-list">
                  {editDepositPayments.map((payment, index) => (
                    <div className="deposit-payment-row" key={payment.id}>
                      <label>
                        付款日期
                        <input
                          type="date"
                          value={payment.paid_date}
                          onChange={(event) => updateEditDepositPayment(payment.id, 'paid_date', event.target.value)}
                        />
                      </label>
                      <label>
                        金額
                        <input
                          type="number"
                          value={payment.amount}
                          onChange={(event) =>
                            updateEditDepositPayment(
                              payment.id,
                              'amount',
                              event.target.value === '' ? '' : Number(event.target.value || 0),
                            )
                          }
                          placeholder={`第 ${index + 1} 筆訂金`}
                        />
                      </label>
                      <label>
                        末五碼
                        <input
                          inputMode="numeric"
                          maxLength={5}
                          value={payment.last5}
                          onChange={(event) =>
                            updateEditDepositPayment(payment.id, 'last5', event.target.value.replace(/\D/g, '').slice(0, 5))
                          }
                          placeholder="例如 12345"
                        />
                      </label>
                      <label>
                        備註
                        <input
                          value={payment.note}
                          onChange={(event) => updateEditDepositPayment(payment.id, 'note', event.target.value)}
                          placeholder="例如 加訂房間、已對帳"
                        />
                      </label>
                      <button
                        className={payment.confirmed ? 'primary-button' : 'secondary-button'}
                        type="button"
                        onClick={() => updateEditDepositPayment(payment.id, 'confirmed', !payment.confirmed)}
                      >
                        {payment.confirmed ? '已對帳' : '待對帳'}
                      </button>
                      <button className="secondary-button" type="button" onClick={() => removeEditDepositPayment(payment.id)}>
                        移除
                      </button>
                    </div>
                  ))}
                </div>
                <button className="secondary-button" type="button" onClick={addEditDepositPayment}>
                  新增一筆付款
                </button>
              </section>
              <label>
                發票需求
                <select
                  value={editForm.invoice_status}
                  onChange={(event) => updateEditForm('invoice_status', event.target.value as InvoiceStatus)}
                >
                  <option value="none">不需發票</option>
                  <option value="month_end">需要發票，月底開立</option>
                  <option value="onsite">需要發票，現場開立</option>
                  <option value="issued">已開發票</option>
                </select>
              </label>
              <label>
                發票備註 / 統編資料
                <input
                  value={editForm.invoice_note}
                  onChange={(event) => updateEditForm('invoice_note', event.target.value)}
                  placeholder="統編、抬頭、Email 或現場備註"
                />
              </label>
              <label>
                小型犬數量
                <input
                  min={0}
                  type="number"
                  value={editForm.small_pet_count}
                  onChange={(event) =>
                    updateEditForm('small_pet_count', event.target.value === '' ? '' : Number(event.target.value || 0))
                  }
                  placeholder="無則空白"
                />
              </label>
              <label>
                大型犬數量
                <input
                  min={0}
                  type="number"
                  value={editForm.large_pet_count}
                  onChange={(event) =>
                    updateEditForm('large_pet_count', event.target.value === '' ? '' : Number(event.target.value || 0))
                  }
                  placeholder="無則空白"
                />
              </label>
              <label>
                小型犬每晚清潔費
                <input
                  min={0}
                  type="number"
                  value={editForm.small_pet_fee_per_night}
                  onChange={(event) =>
                    updateEditForm(
                      'small_pet_fee_per_night',
                      event.target.value === '' ? '' : Number(event.target.value || 0),
                    )
                  }
                />
              </label>
              <label>
                大型犬每晚清潔費
                <input
                  min={0}
                  type="number"
                  value={editForm.large_pet_fee_per_night}
                  onChange={(event) =>
                    updateEditForm(
                      'large_pet_fee_per_night',
                      event.target.value === '' ? '' : Number(event.target.value || 0),
                    )
                  }
                />
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={editForm.cancellation_postponement}
                  onChange={(event) => updateEditForm('cancellation_postponement', event.target.checked)}
                />
                取消延期
              </label>
              <div className="field-preview">
                <span>房型</span>
                <strong>{summarizeRooms(editSelectedRooms, activeRoomCount)}</strong>
              </div>
              <div className="field-preview">
                <span>晚數</span>
                <strong>{editStayDates.length} 晚</strong>
              </div>
              <div className="field-preview">
                <span>原房價合計</span>
                <strong>{formatPrice(editRackTotalAmount)}</strong>
              </div>
              <div className="field-preview">
                <span>寵物清潔費</span>
                <strong>{formatPrice(editPetCleaningFee)}</strong>
                {(editSmallPetCount > 0 || editLargePetCount > 0) && (
                  <span>
                    小型犬 {editSmallPetCount}、大型犬 {editLargePetCount}，{editStayDates.length} 晚
                  </span>
                )}
              </div>
              <label>
                優待折扣
                <input
                  min={0}
                  type="number"
                  value={editForm.discount_amount}
                  onChange={(event) =>
                    updateEditForm(
                      'discount_amount',
                      event.target.value === '' ? '' : Number(event.target.value || 0),
                    )
                  }
                  placeholder="不填則無折扣"
                />
              </label>
              <div className="field-preview">
                <span>優待後總額</span>
                <strong>{formatPrice(editTotalAmount)}</strong>
              </div>
              <div className="field-preview">
                <span>訂金合計</span>
                <strong>{formatPrice(editDepositTotalAmount)}</strong>
              </div>
              <div className="field-preview">
                <span>重算尾款</span>
                <strong>{formatPrice(editBalanceAmount)}</strong>
              </div>
              <div className="form-actions wide">
                <button className="primary-button" disabled={savingOrder}>
                  {savingOrder ? '儲存中...' : '儲存訂單'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {editCompletionMessage && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal">
            <div className="modal-header">
              <div>
                <p className="eyebrow">Order updated</p>
                <h2>訂房已修改</h2>
              </div>
              <button className="icon-button" onClick={() => setEditCompletionMessage('')} title="關閉">
                <X size={18} />
              </button>
            </div>
            <div className="page-stack">
              {editCompletionCopyError && <div className="form-error">{editCompletionCopyError}</div>}
              <div className="completion-actions">
                <button className="primary-button" type="button" onClick={copyEditCompletionMessage}>
                  {editCompletionCopied ? <Check size={18} /> : <Clipboard size={18} />}
                  {editCompletionCopied ? '已複製' : '複製給客人的通知'}
                </button>
                <button className="secondary-button" type="button" onClick={() => setEditCompletionMessage('')}>
                  關閉
                </button>
              </div>
              <textarea className="message-preview compact-message-preview" readOnly value={editCompletionMessage} rows={8} />
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function MobileBookingCard({
  order,
  activeRoomCount,
  canEdit,
  onEdit,
  onDelete,
}: {
  order: BookingOrderWithBookings;
  activeRoomCount: number;
  canEdit: boolean;
  onEdit: (order: BookingOrderWithBookings) => void;
  onDelete: (order: BookingOrderWithBookings) => void;
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
            <span>入住：{order.check_in_date}</span>
            <span>退房：{order.check_out_date}</span>
            <span>晚數：{getNightCount(order.check_in_date, order.check_out_date)} 晚</span>
          </div>
        </div>
        <div className="mobile-order-card-detail">
          <span>總額：{formatPrice(order.total_amount)}</span>
          <span>訂金：{formatPrice(order.deposit_amount)}</span>
          <span>尾款：{formatPrice(order.balance_amount)}</span>
          <span>房間：{order.room_count} 間</span>
          <span>房型：{renderRoomTypeSummary(order, activeRoomCount)}</span>
          <span>末五碼：{order.deposit_payment_last5 || '-'}</span>
        </div>
        <div className="mobile-order-card-side">
          <span>發票</span>
          <div className="mobile-order-card-side-box">{renderInvoiceStatus(normalizeInvoiceStatus(order.invoice_status))}</div>
          <span>狀態</span>
          <span className={`status mobile-card-status ${bookingOrderStatusClass(order)}`}>
            {bookingOrderStatusLabel(order)}
          </span>
          {canEdit && (
            <div className="mobile-order-card-actions">
              <button className="secondary-button" onClick={() => onEdit(order)}>
                <Edit3 size={16} />
                修改訂單
              </button>
              <button className="danger-button" onClick={() => onDelete(order)}>
                <Trash2 size={16} />
                刪除
              </button>
            </div>
          )}
        </div>
        <div className="mobile-order-card-note">訂單備註：{cleanNoteForDisplay(order.note)}</div>
      </div>
    </article>
  );
}

function summarizeRoomTypes(order: BookingOrderWithBookings, activeRoomCount = 0) {
  if (activeRoomCount > 0 && Number(order.room_count || 0) >= activeRoomCount) {
    return '包場';
  }

  return getRoomTypeSummaryParts(order).join('、');
}

function renderRoomTypeSummary(order: BookingOrderWithBookings, activeRoomCount = 0) {
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

function summarizeRooms(rooms: Array<Pick<Room, 'room_type'>>, activeRoomCount = 0) {
  if (activeRoomCount > 0 && rooms.length >= activeRoomCount) {
    return '包場';
  }

  const counts = new Map<string, number>();
  rooms.forEach((room) => {
    const roomType = room.room_type || '未設定房型';
    counts.set(roomType, (counts.get(roomType) ?? 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([roomType, count]) => `${roomType} x ${count}`)
    .join('、');
}

function calculateOrderTotal(
  order: BookingOrderWithBookings,
  dates: string[],
  rules: PriceRule[],
  calendar: PriceCalendar[],
) {
  return order.bookings.reduce((sum, booking) => {
    if (!booking.rooms) return sum + Number(booking.room_price || 0);
    return sum + calculateRoomStayTotal(booking.rooms, dates, rules, calendar);
  }, 0);
}

function calculateRoomsTotal(
  rooms: Array<Pick<Room, 'camp_id' | 'room_type' | 'base_price'>>,
  dates: string[],
  rules: PriceRule[],
  calendar: PriceCalendar[],
) {
  return rooms.reduce((sum, room) => sum + calculateRoomStayTotal(room, dates, rules, calendar), 0);
}

function calculateRoomStayTotal(
  room: { camp_id?: string | null; room_type: string | null; base_price: number },
  dates: string[],
  rules: PriceRule[],
  calendar: PriceCalendar[],
) {
  return dates.reduce((sum, date) => sum + getRoomNightPrice(room, date, rules, calendar), 0);
}

function getRoomNightPrice(
  room: { camp_id?: string | null; room_type: string | null; base_price: number },
  date: string,
  rules: PriceRule[],
  calendar: PriceCalendar[],
) {
  const customPrice = getCustomCalendarPrice(room.camp_id ?? null, room.room_type, date, calendar);
  if (customPrice !== null) return customPrice;

  const category = getRateCategory(room.camp_id ?? null, date, calendar);
  const rule =
    rules.find(
      (item) => item.camp_id === (room.camp_id ?? null) && item.room_type === room.room_type && item.rate_category === category,
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

function datesBetween(checkInDate: string, checkOutDate: string) {
  if (!checkInDate || !checkOutDate || checkOutDate <= checkInDate) return [];

  const dates: string[] = [];
  const current = parseLocalDate(checkInDate);
  const end = parseLocalDate(checkOutDate);

  while (current < end) {
    dates.push(formatLocalDate(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
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

function splitOrderNoteAndPayments(note: string, depositAmount: number, last5: string | null, depositConfirmed = false) {
  const marker = '訂金付款紀錄：';
  const markerIndex = note.indexOf(marker);
  const fallbackPayment: DepositPayment = {
    id: createClientId(),
    paid_date: formatLocalDate(new Date()),
    amount: depositAmount !== 0 ? depositAmount : '',
    last5: last5 ?? '',
    confirmed: depositConfirmed,
    note: '',
  };

  if (markerIndex === -1) {
    return {
      baseNote: note,
      payments: depositAmount !== 0 || last5 ? [fallbackPayment] : [emptyDepositPayment()],
    };
  }

  const baseNote = note.slice(0, markerIndex).trim();
  const paymentText = note.slice(markerIndex + marker.length).trim();
  const payments = paymentText
    .split('\n')
    .map((line) => parsePaymentLine(line))
    .filter((payment): payment is DepositPayment => Boolean(payment));

  return {
    baseNote,
    payments: payments.length > 0 ? payments : [fallbackPayment],
  };
}

function parsePaymentLine(line: string): DepositPayment | null {
  const parts = line
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const datePart = parts.find((part) => /^\d{4}-\d{2}-\d{2}$/.test(part)) ?? formatLocalDate(new Date());
  const last5Part = parts.find((part) => part.includes('末五碼')) ?? '';
  const amountPart =
    parts.find((part) => part !== datePart && part.includes('$')) ??
    parts.find(
      (part) =>
        part !== datePart &&
        part !== last5Part &&
        !part.startsWith('第 ') &&
        !part.includes('末五碼') &&
        !part.includes('已對帳') &&
        !part.includes('待對帳') &&
        part.toUpperCase() !== 'OK' &&
        /^-?[\d,]+$/.test(part),
    ) ??
    '';
  const confirmed = parts.some((part) => part.includes('已對帳') || part.toUpperCase() === 'OK');
  const noteParts = parts.filter(
    (part) =>
      !part.startsWith('第 ') &&
      part !== datePart &&
      part !== amountPart &&
      part !== last5Part &&
      !part.includes('已對帳') &&
      !part.includes('待對帳') &&
      part.toUpperCase() !== 'OK',
  );

  return {
    id: createClientId(),
    paid_date: datePart,
    amount: parseMoneyAmount(amountPart),
    last5: last5Part.replace(/[^\d]/g, '').slice(0, 5),
    confirmed,
    note: noteParts.join(' / '),
  };
}

function parseMoneyAmount(value: string): number | '' {
  const normalized = value.replace(/[^\d-]/g, '');
  if (!normalized || normalized === '-') return '';
  return Number(normalized);
}

function emptyDepositPayment(): DepositPayment {
  return { id: createClientId(), paid_date: formatLocalDate(new Date()), amount: '', last5: '', confirmed: false, note: '' };
}

function isActiveDepositPayment(payment: DepositPayment) {
  return Number(payment.amount || 0) !== 0 || payment.last5.trim() || payment.note.trim();
}

function getStatusFromLatestPayment(payment: DepositPayment | undefined): BookingStatus {
  if (!payment) return 'pending';
  return payment.confirmed ? 'confirmed' : 'awaiting_deposit_confirmation';
}

function buildOrderNote(baseNote: string, payments: DepositPayment[]) {
  const paymentLines = payments
    .filter(isActiveDepositPayment)
    .map((payment, index) => {
      const parts = [
        `第 ${index + 1} 筆`,
        payment.paid_date,
        formatPrice(Number(payment.amount || 0)),
        payment.last5.trim() ? `末五碼 ${payment.last5.trim()}` : '',
        payment.confirmed ? '已對帳' : '待對帳',
        payment.note.trim(),
      ].filter(Boolean);
      return parts.join(' / ');
    });

  if (paymentLines.length === 0) return baseNote.trim();

  return [baseNote.trim(), '訂金付款紀錄：', ...paymentLines].filter(Boolean).join('\n');
}

function cleanNoteForDisplay(note: string | null | undefined) {
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
  return labels[status] ?? status;
}

function renderInvoiceStatus(status: InvoiceStatus) {
  return <span className={`invoice-badge invoice-badge-${status}`}>{invoiceStatusLabel(status)}</span>;
}

function normalizeInvoiceStatus(status: string | null | undefined): InvoiceStatus {
  if (status === 'issued' || status === 'month_end' || status === 'onsite' || status === 'none') return status;
  return 'none';
}

function buildEditCompletionMessage({
  checkInDate,
  checkOutDate,
  guestName,
  guestPhone,
  rooms,
  totalAmount,
}: {
  checkInDate: string;
  checkOutDate: string;
  guestName: string;
  guestPhone: string;
  rooms: string;
  totalAmount: number;
}) {
  return `更改房型完成✔️
入住日：${formatDisplayDateWithWeekday(checkInDate)}
退房日：${formatDisplayDateWithWeekday(checkOutDate)}
姓名：${guestName}
電話：${guestPhone || '未填'}
房型：${rooms}
總房價：${formatPrice(totalAmount)}`;
}

function copyTextWithFallback(text: string) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!copied) throw new Error('copy failed');
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

function getNightCount(checkInDate: string, checkOutDate: string) {
  const checkIn = parseLocalDate(checkInDate).getTime();
  const checkOut = parseLocalDate(checkOutDate).getTime();
  const days = Math.round((checkOut - checkIn) / 86400000);
  return Math.max(days, 1);
}

function formatCompactDate(date: string) {
  return date.replace(/-/g, '');
}

function getOrderDateSearchValues(order: Pick<BookingOrderWithBookings, 'check_in_date' | 'check_out_date'>) {
  const stayDates = datesBetween(order.check_in_date, order.check_out_date);
  const allDates = [order.check_in_date, order.check_out_date, ...stayDates];
  const dateValues = allDates.flatMap(formatDateSearchValues);
  return [
    ...dateValues,
    `${order.check_in_date} ${order.check_out_date}`,
    `${formatCompactDate(order.check_in_date)} ${formatCompactDate(order.check_out_date)}`,
    `${formatDisplayDate(order.check_in_date)} ${formatDisplayDate(order.check_out_date)}`,
  ];
}

function formatDateSearchValues(date: string) {
  const [year, month, day] = date.split('-');
  const monthNumber = String(Number(month));
  const dayNumber = String(Number(day));

  return [
    date,
    `${year}${month}${day}`,
    `${year}/${month}/${day}`,
    `${year}/${monthNumber}/${dayNumber}`,
    `${month}/${day}`,
    `${monthNumber}/${dayNumber}`,
    `${month}${day}`,
    `${monthNumber}月${dayNumber}日`,
  ];
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0,
  }).format(price);
}
