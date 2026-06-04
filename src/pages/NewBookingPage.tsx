import { Check, Clipboard } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ALL_CAMPS, useCamp } from '../contexts/CampContext';
import { createClientId } from '../lib/id';
import { getRoomTypeClass, getRoomTypeLabel, ROOM_TYPE_LEGEND, sortRoomsByDisplayOrder } from '../lib/rooms';
import { supabase } from '../lib/supabase';
import type { BookingStatus, InvoiceStatus, PriceCalendar, PriceRule, RateCategory, Room } from '../types/database';

const today = formatLocalDate(new Date());
const tomorrow = addDays(today, 1);
const DEFAULT_SMALL_PET_FEE = 300;
const DEFAULT_LARGE_PET_FEE = 500;
const DEFAULT_EXTRA_PERSON_FEE = 500;
const EXTRA_PERSON_ROOM_TYPES = ['四人小木屋', '六人樓中樓'];

type NewOrderForm = {
  guest_name: string;
  guest_phone: string;
  check_in_date: string;
  check_out_date: string;
  discount_amount: number | '';
  small_pet_count: number | '';
  large_pet_count: number | '';
  small_pet_fee_per_night: number | '';
  large_pet_fee_per_night: number | '';
  extra_person_count: number | '';
  extra_person_fee_per_night: number | '';
  invoice_status: InvoiceStatus;
  invoice_note: string;
  status: BookingStatus;
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

type RateInfo = {
  category: RateCategory;
  reason: string;
};

type BookingDateField = 'check_in_date' | 'check_out_date';

const NEW_BOOKING_DRAFT_KEY = 'booking-app-new-booking-draft-v1';

type NewBookingDraft = {
  orderCampId: string;
  form: NewOrderForm;
  depositPayments: DepositPayment[];
  isExclusiveBooking: boolean;
  roomTypeFilter: string;
};

function createEmptyOrderForm(): NewOrderForm {
  return {
    guest_name: '',
    guest_phone: '',
    check_in_date: today,
    check_out_date: tomorrow,
    discount_amount: '',
    small_pet_count: '',
    large_pet_count: '',
    small_pet_fee_per_night: DEFAULT_SMALL_PET_FEE,
    large_pet_fee_per_night: DEFAULT_LARGE_PET_FEE,
    extra_person_count: '',
    extra_person_fee_per_night: DEFAULT_EXTRA_PERSON_FEE,
    invoice_status: 'none',
    invoice_note: '',
    status: 'pending',
    note: '',
  };
}

function createEmptyDepositPayment(): DepositPayment {
  return { id: createClientId(), paid_date: today, amount: '', last5: '', confirmed: false, note: '' };
}

function readNewBookingDraft(): Partial<NewBookingDraft> | null {
  if (typeof window === 'undefined') return null;
  try {
    const rawDraft = window.localStorage.getItem(NEW_BOOKING_DRAFT_KEY);
    return rawDraft ? (JSON.parse(rawDraft) as Partial<NewBookingDraft>) : null;
  } catch {
    return null;
  }
}

function normalizeNewBookingForm(draftForm?: Partial<NewOrderForm>): NewOrderForm {
  const emptyForm = createEmptyOrderForm();
  if (!draftForm) return emptyForm;
  return {
    ...emptyForm,
    ...draftForm,
    check_in_date: isValidDateString(draftForm.check_in_date ?? '') ? draftForm.check_in_date! : emptyForm.check_in_date,
    check_out_date: isValidDateString(draftForm.check_out_date ?? '') ? draftForm.check_out_date! : emptyForm.check_out_date,
  };
}

function normalizeDepositPayments(payments?: DepositPayment[]): DepositPayment[] {
  if (!Array.isArray(payments) || payments.length === 0) return [createEmptyDepositPayment()];
  return payments.map((payment) => ({
    ...createEmptyDepositPayment(),
    ...payment,
    id: payment.id || createClientId(),
    paid_date: isValidDateString(payment.paid_date) ? payment.paid_date : today,
  }));
}

export function NewBookingPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { camps, selectedCampId } = useCamp();
  const initialDraftRef = useRef<{ loaded: boolean; value: Partial<NewBookingDraft> | null }>({
    loaded: false,
    value: null,
  });
  if (!initialDraftRef.current.loaded) {
    initialDraftRef.current = { loaded: true, value: readNewBookingDraft() };
  }
  const initialDraft = initialDraftRef.current.value;
  const [orderCampId, setOrderCampId] = useState(initialDraft?.orderCampId ?? '');
  const [rooms, setRooms] = useState<Room[]>([]);
  const [bookedRoomIds, setBookedRoomIds] = useState<Set<string>>(new Set());
  const [priceRules, setPriceRules] = useState<PriceRule[]>([]);
  const [priceCalendar, setPriceCalendar] = useState<PriceCalendar[]>([]);
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [error, setError] = useState('');
  const [completionMessage, setCompletionMessage] = useState('');
  const [completionCopyError, setCompletionCopyError] = useState('');
  const [copied, setCopied] = useState(false);
  const completionMessageRef = useRef<HTMLTextAreaElement | null>(null);
  const [isExclusiveBooking, setIsExclusiveBooking] = useState(initialDraft?.isExclusiveBooking ?? false);
  const [roomTypeFilter, setRoomTypeFilter] = useState(initialDraft?.roomTypeFilter ?? 'all');
  const [openDatePicker, setOpenDatePicker] = useState<BookingDateField | null>(null);
  const [bookingCalendarMonth, setBookingCalendarMonth] = useState(
    startOfMonth(
      isValidDateString(initialDraft?.form?.check_in_date ?? '') ? initialDraft!.form!.check_in_date : today,
    ),
  );
  const [openPaymentDatePicker, setOpenPaymentDatePicker] = useState<string | null>(null);
  const [paymentCalendarMonth, setPaymentCalendarMonth] = useState(startOfMonth(today));
  const [depositPayments, setDepositPayments] = useState<DepositPayment[]>(() =>
    normalizeDepositPayments(initialDraft?.depositPayments),
  );
  const [form, setForm] = useState<NewOrderForm>(() => normalizeNewBookingForm(initialDraft?.form));
  const [draftSaveEnabled, setDraftSaveEnabled] = useState(true);

  useEffect(() => {
    if (!draftSaveEnabled) return;
    try {
      window.localStorage.setItem(
        NEW_BOOKING_DRAFT_KEY,
        JSON.stringify({ orderCampId, form, depositPayments, isExclusiveBooking, roomTypeFilter }),
      );
    } catch {
      // Draft saving is a convenience only; booking flow should keep working if storage is unavailable.
    }
  }, [draftSaveEnabled, orderCampId, form, depositPayments, isExclusiveBooking, roomTypeFilter]);

  useEffect(() => {
    if (selectedCampId !== ALL_CAMPS) {
      setOrderCampId(selectedCampId);
      return;
    }
    setOrderCampId((current) => current || camps[0]?.id || '');
  }, [camps, selectedCampId]);

  useEffect(() => {
    let ignore = false;

    async function loadData() {
      if (!orderCampId) {
        setRooms([]);
        setSelectedRoomIds([]);
        return;
      }

      setRooms([]);
      setSelectedRoomIds([]);
      setBookedRoomIds(new Set());
      setError('');

      const [roomResult, ruleResult, calendarResult] = await Promise.all([
        supabase.from('rooms').select('*').eq('is_active', true).eq('camp_id', orderCampId).order('name'),
        supabase.from('price_rules').select('*'),
        supabase.from('price_calendar').select('*').eq('camp_id', orderCampId),
      ]);

      if (ignore) return;
      if (roomResult.error) return setError(roomResult.error.message);
      if (ruleResult.error) return setError(ruleResult.error.message);
      if (calendarResult.error) return setError(calendarResult.error.message);

      setRooms(sortRoomsByDisplayOrder((roomResult.data ?? []).filter((room) => room.camp_id === orderCampId)));
      setPriceRules(ruleResult.data ?? []);
      setPriceCalendar(calendarResult.data ?? []);
    }

    loadData();
    return () => {
      ignore = true;
    };
  }, [orderCampId]);

  useEffect(() => {
    async function loadAvailability() {
      if (
        !isValidDateString(form.check_in_date) ||
        !isValidDateString(form.check_out_date) ||
        form.check_out_date <= form.check_in_date
      ) {
        setBookedRoomIds(new Set());
        return;
      }

      const roomIds = rooms.map((room) => room.id);
      if (roomIds.length === 0) {
        setBookedRoomIds(new Set());
        return;
      }

      setLoadingAvailability(true);
      const { data, error: availabilityError } = await supabase
        .from('bookings')
        .select('room_id')
        .in('room_id', roomIds)
        .lt('check_in_date', form.check_out_date)
        .gt('check_out_date', form.check_in_date)
        .neq('status', 'cancelled');

      if (availabilityError) {
        setError(availabilityError.message);
      } else {
        const nextBookedRoomIds = new Set((data ?? []).map((booking) => booking.room_id));
        setBookedRoomIds(nextBookedRoomIds);
        setSelectedRoomIds((current) => {
          if (isExclusiveBooking) return rooms.filter((room) => !nextBookedRoomIds.has(room.id)).map((room) => room.id);
          return current.filter((roomId) => !nextBookedRoomIds.has(roomId));
        });
      }
      setLoadingAvailability(false);
    }

    loadAvailability();
  }, [form.check_in_date, form.check_out_date, isExclusiveBooking, rooms]);

  const orderCamp = useMemo(() => camps.find((camp) => camp.id === orderCampId) ?? null, [camps, orderCampId]);
  const isQiumuCamp = orderCamp?.name === '秋慕嵐杉';
  const showPetCleaningFee = isQiumuCamp;
  const selectedRooms = useMemo(() => rooms.filter((room) => selectedRoomIds.includes(room.id)), [rooms, selectedRoomIds]);
  const availableRoomTypeLegend = useMemo(() => {
    const roomTypes = Array.from(new Set(rooms.map((room) => getRoomTypeLabel(room))));
    return ROOM_TYPE_LEGEND.filter((item) => roomTypes.includes(item.label));
  }, [rooms]);
  const visibleRooms = useMemo(
    () =>
      rooms.filter((room) => {
        if (roomTypeFilter === 'all') return true;
        if (roomTypeFilter === 'available') return !bookedRoomIds.has(room.id);
        return getRoomTypeLabel(room) === roomTypeFilter;
      }),
    [bookedRoomIds, rooms, roomTypeFilter],
  );
  const stayDates = useMemo(
    () =>
      isValidDateString(form.check_in_date) && isValidDateString(form.check_out_date)
        ? datesBetween(form.check_in_date, form.check_out_date)
        : [],
    [form.check_in_date, form.check_out_date],
  );
  const nights = stayDates.length;
  const firstNightRate = isValidDateString(form.check_in_date)
    ? getRateInfo(form.check_in_date, priceCalendar)
    : ({ category: 'weekday', reason: '請先選擇入住日期' } as RateInfo);
  const stayRateSummary = stayDates.map((date) => ({
    date,
    ...getRateInfo(date, priceCalendar),
  }));
  const totalAmount = selectedRooms.reduce(
    (sum, room) => sum + calculateRoomStayTotal(room, stayDates, priceRules, priceCalendar),
    0,
  );
  const smallPetCount = showPetCleaningFee ? valueToNonNegativeNumber(form.small_pet_count) : 0;
  const largePetCount = showPetCleaningFee ? valueToNonNegativeNumber(form.large_pet_count) : 0;
  const smallPetFeePerNight =
    form.small_pet_fee_per_night === '' ? DEFAULT_SMALL_PET_FEE : valueToNonNegativeNumber(form.small_pet_fee_per_night);
  const largePetFeePerNight =
    form.large_pet_fee_per_night === '' ? DEFAULT_LARGE_PET_FEE : valueToNonNegativeNumber(form.large_pet_fee_per_night);
  const petCleaningFee = showPetCleaningFee
    ? nights * (smallPetCount * smallPetFeePerNight + largePetCount * largePetFeePerNight)
    : 0;
  const extraPersonEligibleRoomCount = selectedRooms.filter((room) =>
    EXTRA_PERSON_ROOM_TYPES.includes(getRoomTypeLabel(room)),
  ).length;
  const maxExtraPersonCount = extraPersonEligibleRoomCount * 2;
  const rawExtraPersonCount = valueToNonNegativeNumber(form.extra_person_count);
  const extraPersonCount = isQiumuCamp ? Math.min(rawExtraPersonCount, maxExtraPersonCount) : 0;
  const extraPersonFeePerNight =
    form.extra_person_fee_per_night === '' ? DEFAULT_EXTRA_PERSON_FEE : valueToNonNegativeNumber(form.extra_person_fee_per_night);
  const extraPersonFee = isQiumuCamp ? nights * extraPersonCount * extraPersonFeePerNight : 0;
  const discountAmount = valueToNonNegativeNumber(form.discount_amount);
  const finalTotalAmount = Math.max(totalAmount + petCleaningFee + extraPersonFee - discountAmount, 0);
  const totalDepositAmount = depositPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const activeDepositPayments = depositPayments.filter(isActiveDepositPayment);
  const latestDepositPayment = [...activeDepositPayments].reverse()[0];
  const latestDepositLast5 = [...activeDepositPayments]
    .reverse()
    .find((payment) => payment.last5.trim().length === 5)
    ?.last5.trim();
  const orderStatus: BookingStatus = getStatusFromLatestPayment(latestDepositPayment);
  const balanceAmount = Math.max(finalTotalAmount - totalDepositAmount, 0);

  function updateField<K extends keyof NewOrderForm>(key: K, value: NewOrderForm[K]) {
    setForm((current) => {
      if (key === 'check_in_date') {
        const nextCheckInDate = String(value);
        if (!isValidDateString(nextCheckInDate)) return { ...current, check_in_date: nextCheckInDate };
        return { ...current, check_in_date: nextCheckInDate, check_out_date: addDays(nextCheckInDate, 1) };
      }
      return { ...current, [key]: value };
    });
  }

  function openBookingDatePicker(field: BookingDateField, value: string) {
    setBookingCalendarMonth(startOfMonth(isValidDateString(value) ? value : today));
    setOpenDatePicker((current) => (current === field ? null : field));
  }

  function selectBookingDate(field: BookingDateField, value: string) {
    updateField(field, value);
    setOpenDatePicker(null);
  }

  function moveBookingCalendarMonth(months: number) {
    setBookingCalendarMonth((current) => addMonths(current, months));
  }

  function openDepositDatePicker(id: string, value: string) {
    setPaymentCalendarMonth(startOfMonth(isValidDateString(value) ? value : today));
    setOpenPaymentDatePicker((current) => (current === id ? null : id));
  }

  function selectDepositDate(id: string, value: string) {
    updateDepositPayment(id, 'paid_date', value);
    setOpenPaymentDatePicker(null);
  }

  function movePaymentCalendarMonth(months: number) {
    setPaymentCalendarMonth((current) => addMonths(current, months));
  }

  function toggleRoom(roomId: string) {
    if (bookedRoomIds.has(roomId) || isExclusiveBooking) return;
    setSelectedRoomIds((current) =>
      current.includes(roomId) ? current.filter((id) => id !== roomId) : [...current, roomId],
    );
  }

  function toggleExclusiveBooking(checked: boolean) {
    setIsExclusiveBooking(checked);
    setSelectedRoomIds(checked ? rooms.filter((room) => !bookedRoomIds.has(room.id)).map((room) => room.id) : []);
  }

  function addDepositPayment() {
    setDepositPayments((current) => [...current, createEmptyDepositPayment()]);
  }

  function removeDepositPayment(id: string) {
    setDepositPayments((current) =>
      current.length === 1 ? [createEmptyDepositPayment()] : current.filter((payment) => payment.id !== id),
    );
  }

  function updateDepositPayment<K extends keyof DepositPayment>(id: string, key: K, value: DepositPayment[K]) {
    setDepositPayments((current) =>
      current.map((payment) => (payment.id === id ? { ...payment, [key]: value } : payment)),
    );
  }

  async function createBookingOrder(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setCompletionMessage('');

    try {
      if (!orderCampId) throw new Error('請先選擇營區');
      if (!form.guest_name.trim()) throw new Error('請填寫住客姓名');
      if (!isValidDateString(form.check_in_date) || !isValidDateString(form.check_out_date)) {
        throw new Error('請確認入住日期與退房日期');
      }
      if (form.check_out_date <= form.check_in_date) throw new Error('退房日期必須晚於入住日期');
      if (selectedRooms.length === 0) throw new Error('請選擇至少一間可預訂房間');
      if (selectedRoomIds.some((roomId) => bookedRoomIds.has(roomId))) throw new Error('已預訂的房間不能重複訂房');
      if (isQiumuCamp && rawExtraPersonCount > maxExtraPersonCount) {
        throw new Error(`加人數量超過上限，已選房型最多可加 ${maxExtraPersonCount} 人`);
      }
      const invalidLast5 = activeDepositPayments.find((payment) => payment.last5.trim() && !/^\d{5}$/.test(payment.last5.trim()));
      if (invalidLast5) throw new Error('訂金付款末五碼請輸入 5 位數字');

      const latestActivePayment = [...activeDepositPayments].reverse()[0];
      const nextStatus = getStatusFromLatestPayment(latestActivePayment);
      const orderNote = buildOrderNote(form.note, activeDepositPayments);

      const orderPayload = {
        camp_id: orderCampId,
        guest_name: form.guest_name.trim(),
        guest_phone: form.guest_phone.trim() || null,
        company_contact: null,
        check_in_date: form.check_in_date,
        check_out_date: form.check_out_date,
        room_count: selectedRooms.length,
        small_pet_count: showPetCleaningFee ? smallPetCount : 0,
        large_pet_count: showPetCleaningFee ? largePetCount : 0,
        small_pet_fee_per_night: showPetCleaningFee ? smallPetFeePerNight : DEFAULT_SMALL_PET_FEE,
        large_pet_fee_per_night: showPetCleaningFee ? largePetFeePerNight : DEFAULT_LARGE_PET_FEE,
        extra_person_count: isQiumuCamp ? extraPersonCount : 0,
        extra_person_fee_per_night: isQiumuCamp ? extraPersonFeePerNight : DEFAULT_EXTRA_PERSON_FEE,
        total_amount: finalTotalAmount,
        deposit_amount: totalDepositAmount,
        balance_amount: balanceAmount,
        deposit_payment_last5: latestDepositLast5 || null,
        deposit_confirmed: latestActivePayment?.confirmed ?? false,
        deposit_confirmed_at: latestActivePayment?.confirmed ? new Date().toISOString() : null,
        cancellation_postponement: false,
        invoice_status: form.invoice_status,
        invoice_note: form.invoice_note.trim() || null,
        status: nextStatus,
        note: orderNote || null,
        created_by: user?.id ?? null,
        updated_by: user?.id ?? null,
      };

      const { data: order, error: orderError } = await supabase
        .from('booking_orders')
        .insert(orderPayload)
        .select()
        .single();

      if (orderError) throw orderError;

      const bookingsPayload = selectedRooms.map((room) => ({
        order_id: order.id,
        room_id: room.id,
        guest_name: form.guest_name.trim(),
        guest_phone: form.guest_phone.trim() || null,
        company_contact: null,
        check_in_date: form.check_in_date,
        check_out_date: form.check_out_date,
        room_price: calculateRoomStayTotal(room, stayDates, priceRules, priceCalendar),
        status: nextStatus,
        note: form.note.trim() || null,
        created_by: user?.id ?? null,
        updated_by: user?.id ?? null,
      }));

      const { error: bookingError } = await supabase.from('bookings').insert(bookingsPayload);
      if (bookingError) throw bookingError;

      const roomsText = isExclusiveBooking ? '包場' : summarizeSelectedRoomTypes(selectedRooms);
      setCompletionMessage(
        buildCampCompletionMessage({
          campName: orderCamp?.name || '',
          checkInDate: form.check_in_date,
          checkOutDate: form.check_out_date,
          rooms: roomsText,
          guestName: form.guest_name.trim(),
          guestPhone: form.guest_phone.trim(),
          petSummary: buildPetSummary(smallPetCount, largePetCount),
          extraPersonSummary: buildExtraPersonSummary(extraPersonCount, extraPersonFeePerNight),
          totalAmount: finalTotalAmount,
          transferAmount: Math.round(finalTotalAmount / 2),
        }),
      );
      setCopied(false);
      setSelectedRoomIds([]);
      setIsExclusiveBooking(false);
      setDepositPayments([createEmptyDepositPayment()]);
      setDraftSaveEnabled(false);
      window.localStorage.removeItem(NEW_BOOKING_DRAFT_KEY);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '建立訂單失敗');
    } finally {
      setSaving(false);
    }
  }

  async function copyCompletionMessage() {
    setCompletionCopyError('');
    setCopied(false);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(completionMessage);
      } else {
        copyTextWithFallback(completionMessage);
      }
      setCopied(true);
    } catch {
      try {
        copyTextWithFallback(completionMessage);
        setCopied(true);
      } catch {
        const textarea = completionMessageRef.current;
        if (textarea) {
          textarea.focus();
          textarea.select();
          textarea.setSelectionRange(0, textarea.value.length);
        }
        setCompletionCopyError('瀏覽器暫時不允許自動複製，已幫你選取文字，請長按或使用複製。');
      }
    }
  }

  return (
    <section className="page-section">
      <div className="page-heading">
        <p className="eyebrow">New booking order</p>
        <h1>新增訂房</h1>
      </div>

      {completionMessage && (
        <div className="completion-modal-backdrop">
          <div className="panel completion-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Booking message</p>
              <h2>訂房完成通知</h2>
            </div>
            <button className="secondary-button" type="button" onClick={copyCompletionMessage}>
              {copied ? <Check size={18} /> : <Clipboard size={18} />}
              {copied ? '已複製' : '複製給客人'}
          </button>
          </div>
          <textarea
            ref={completionMessageRef}
            readOnly
            value={completionMessage}
            onFocus={(event) => event.currentTarget.select()}
          />
          {completionCopyError && <p className="form-error">{completionCopyError}</p>}
          <div className="completion-actions">
            <button className="primary-button" type="button" onClick={() => navigate('/bookings')}>
              前往訂房列表
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setCompletionMessage('');
                setForm(createEmptyOrderForm());
                setDepositPayments([createEmptyDepositPayment()]);
                setSelectedRoomIds([]);
                setIsExclusiveBooking(false);
                setRoomTypeFilter('all');
                setDraftSaveEnabled(true);
              }}
            >
              繼續新增訂房
            </button>
          </div>
          </div>
        </div>
      )}

      <form className="form-card" onSubmit={createBookingOrder}>
        {error && <div className="form-error">{error}</div>}

        <div className="form-grid booking-info-grid">
          <label className="booking-camp">
            營區
            <select
              value={orderCampId}
              onChange={(event) => {
                setOrderCampId(event.target.value);
                setRoomTypeFilter('all');
              }}
            >
              {camps.map((camp) => (
                <option key={camp.id} value={camp.id}>
                  {camp.name}
                </option>
              ))}
            </select>
          </label>

          <label className="booking-check-in">
            入住日期
            <CuteDatePicker
              month={bookingCalendarMonth}
              open={openDatePicker === 'check_in_date'}
              value={form.check_in_date}
              onClose={() => setOpenDatePicker(null)}
              onMoveMonth={moveBookingCalendarMonth}
              onSelect={(date) => selectBookingDate('check_in_date', date)}
              onToggle={() => openBookingDatePicker('check_in_date', form.check_in_date)}
            />
          </label>
          <label className="booking-check-out">
            退房日期
            <CuteDatePicker
              month={bookingCalendarMonth}
              open={openDatePicker === 'check_out_date'}
              value={form.check_out_date}
              onClose={() => setOpenDatePicker(null)}
              onMoveMonth={moveBookingCalendarMonth}
              onSelect={(date) => selectBookingDate('check_out_date', date)}
              onToggle={() => openBookingDatePicker('check_out_date', form.check_out_date)}
            />
          </label>
          <label className="booking-guest-name">
            住客姓名
            <input value={form.guest_name} onChange={(event) => updateField('guest_name', event.target.value)} />
          </label>
          <label className="booking-guest-phone">
            住客電話
            <input value={form.guest_phone} onChange={(event) => updateField('guest_phone', event.target.value)} />
          </label>
          <label className="booking-invoice-status">
            發票需求
            <select value={form.invoice_status} onChange={(event) => updateField('invoice_status', event.target.value as InvoiceStatus)}>
              <option value="none">不需發票</option>
              <option value="month_end">月底開立</option>
              <option value="onsite">現場開立</option>
              <option value="issued">已開立</option>
            </select>
          </label>
          <label className="booking-invoice-note">
            發票備註 / 統編資料
            <input
              value={form.invoice_note}
              onChange={(event) => updateField('invoice_note', event.target.value)}
              placeholder="統編、抬頭、Email 或現場備註"
            />
          </label>
          <label className="booking-order-note">
            訂單備註
            <input value={form.note} onChange={(event) => updateField('note', event.target.value)} />
          </label>
          <label className="checkbox-label booking-exclusive">
            <input type="checkbox" checked={isExclusiveBooking} onChange={(event) => toggleExclusiveBooking(event.target.checked)} />
            包場
          </label>
          <label className="booking-status">
            狀態
            <div className="field-preview compact-preview">
              <strong>{statusLabel(orderStatus)}</strong>
              <span>{statusHint(orderStatus)}</span>
            </div>
          </label>
        </div>

        {showPetCleaningFee && (
          <div className="form-grid">
            <label>
              小型犬數量
              <input
                min={0}
                type="number"
                value={form.small_pet_count}
                onChange={(event) => updateField('small_pet_count', event.target.value === '' ? '' : Number(event.target.value || 0))}
                placeholder="無則空白"
              />
            </label>
            <label>
              大型犬數量
              <input
                min={0}
                type="number"
                value={form.large_pet_count}
                onChange={(event) => updateField('large_pet_count', event.target.value === '' ? '' : Number(event.target.value || 0))}
                placeholder="無則空白"
              />
            </label>
            <label>
              小型犬每晚清潔費
              <input
                min={0}
                type="number"
                value={form.small_pet_fee_per_night}
                onChange={(event) =>
                  updateField('small_pet_fee_per_night', event.target.value === '' ? '' : Number(event.target.value || 0))
                }
              />
            </label>
            <label>
              大型犬每晚清潔費
              <input
                min={0}
                type="number"
                value={form.large_pet_fee_per_night}
                onChange={(event) =>
                  updateField('large_pet_fee_per_night', event.target.value === '' ? '' : Number(event.target.value || 0))
                }
              />
            </label>
          </div>
        )}

        {isQiumuCamp && (
          <div className="form-grid">
            <label>
              加人數量
              <input
                max={maxExtraPersonCount}
                min={0}
                type="number"
                value={form.extra_person_count}
                onChange={(event) => updateField('extra_person_count', event.target.value === '' ? '' : Number(event.target.value || 0))}
                placeholder={maxExtraPersonCount > 0 ? `最多 ${maxExtraPersonCount} 人` : '此訂單沒有可加人的房型'}
              />
              {maxExtraPersonCount > 0 && <span className="subtext">四人小木屋、六人樓中樓每間最多可加 2 人</span>}
            </label>
            <label>
              每人每晚加人費
              <input
                min={0}
                type="number"
                value={form.extra_person_fee_per_night}
                onChange={(event) =>
                  updateField('extra_person_fee_per_night', event.target.value === '' ? '' : Number(event.target.value || 0))
                }
              />
            </label>
          </div>
        )}

        <section className="subsection">
          <div className="panel-heading panel-heading-plain">
            <h2>選擇房間</h2>
            <span className="subtext">
              入住日價格：{rateCategoryLabel(firstNightRate.category)}，已選 {selectedRooms.length} 間
              {loadingAvailability ? '，載入空房中...' : ''}
            </span>
          </div>
          {isExclusiveBooking && bookedRoomIds.size > 0 && (
            <div className="form-error">包場日期已有 {bookedRoomIds.size} 間被預訂，請調整日期或取消包場。</div>
          )}
          <div className="rate-reason">
            {stayRateSummary.length === 0 ? '請先選擇有效入住與退房日期' : summarizeStayRateSummary(stayRateSummary)}
          </div>
          <div className="room-type-legend room-type-legend-compact">
            <button
              className={`legend-chip legend-filter ${roomTypeFilter === 'all' ? 'active' : ''}`}
              type="button"
              onClick={() => setRoomTypeFilter('all')}
            >
              全部
            </button>
            {availableRoomTypeLegend.map((item) => (
              <button
                className={`legend-chip legend-filter ${item.className} ${roomTypeFilter === item.label ? 'active' : ''}`}
                key={item.label}
                type="button"
                onClick={() => setRoomTypeFilter(item.label)}
              >
                {item.label}
              </button>
            ))}
            <button
              className={`legend-chip legend-filter legend-booked ${roomTypeFilter === 'available' ? 'active' : ''}`}
              type="button"
              onClick={() => setRoomTypeFilter('available')}
            >
              剩餘可訂
            </button>
          </div>
          <div className="room-pick-grid">
            {visibleRooms.map((room) => {
              const isBooked = bookedRoomIds.has(room.id);
              const firstNightPrice = getRoomNightPrice(room, form.check_in_date, priceRules, priceCalendar);
              const stayTotal = calculateRoomStayTotal(room, stayDates, priceRules, priceCalendar);
              const roomTypeClass = getRoomTypeClass(getRoomTypeLabel(room));
              return (
                <label className={`room-pick ${isBooked ? 'room-pick-disabled' : roomTypeClass}`} key={room.id}>
                  <input
                    type="checkbox"
                    checked={selectedRoomIds.includes(room.id)}
                    disabled={isBooked || isExclusiveBooking}
                    onChange={() => toggleRoom(room.id)}
                  />
                  <span>
                    <strong>{getRoomTypeLabel(room)}</strong>
                    <small>入住日 {formatPrice(firstNightPrice)}</small>
                    <small>{isBooked ? '此區間已被預訂' : nights > 1 ? `${nights} 晚合計 ${formatPrice(stayTotal)}` : '可預訂'}</small>
                  </span>
                </label>
              );
            })}
          </div>
        </section>

        <div className="form-grid">
          <div className="field-preview">
            <span>房間總數</span>
            <strong>{selectedRooms.length} 間</strong>
          </div>
          <div className="field-preview">
            <span>住宿晚數</span>
            <strong>{nights} 晚</strong>
          </div>
          <div className="field-preview">
            <span>房價合計</span>
            <strong>{formatPrice(totalAmount)}</strong>
          </div>
          {showPetCleaningFee && (
            <div className="field-preview">
              <span>寵物清潔費</span>
              <strong>{formatPrice(petCleaningFee)}</strong>
            </div>
          )}
          {isQiumuCamp && (
            <div className="field-preview">
              <span>加人費</span>
              <strong>{formatPrice(extraPersonFee)}</strong>
            </div>
          )}
          <label>
            優待折扣
            <input
              min={0}
              type="number"
              value={form.discount_amount}
              onChange={(event) => updateField('discount_amount', event.target.value === '' ? '' : Number(event.target.value || 0))}
              placeholder="例如 1000，表示總共折價"
            />
          </label>
          <div className="field-preview">
            <span>最終總額</span>
            <strong>{formatPrice(finalTotalAmount)}</strong>
          </div>
          <div className="field-preview">
            <span>訂金合計</span>
            <strong>{formatPrice(totalDepositAmount)}</strong>
          </div>
          <div className="field-preview">
            <span>尾款</span>
            <strong>{formatPrice(balanceAmount)}</strong>
          </div>
        </div>

        <section className="subsection">
          <div className="panel-heading panel-heading-plain">
            <h2>訂金付款紀錄</h2>
            <span className="subtext">可登記多次付款，系統會自動加總訂金。</span>
          </div>
          <div className="deposit-payment-list">
            {depositPayments.map((payment, index) => (
              <div className="deposit-payment-row" key={payment.id}>
                <label>
                  付款日期
                  <CuteDatePicker
                    month={paymentCalendarMonth}
                    open={openPaymentDatePicker === payment.id}
                    value={payment.paid_date}
                    onClose={() => setOpenPaymentDatePicker(null)}
                    onMoveMonth={movePaymentCalendarMonth}
                    onSelect={(date) => selectDepositDate(payment.id, date)}
                    onToggle={() => openDepositDatePicker(payment.id, payment.paid_date)}
                  />
                </label>
                <label>
                  金額
                  <input
                    type="number"
                    value={payment.amount}
                    onChange={(event) =>
                      updateDepositPayment(payment.id, 'amount', event.target.value === '' ? '' : Number(event.target.value || 0))
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
                      updateDepositPayment(payment.id, 'last5', event.target.value.replace(/\D/g, '').slice(0, 5))
                    }
                    placeholder="例如 12345"
                  />
                </label>
                <label>
                  備註
                  <input
                    value={payment.note}
                    onChange={(event) => updateDepositPayment(payment.id, 'note', event.target.value)}
                    placeholder="例如 加訂房間、已對帳"
                  />
                </label>
                <button
                  className={payment.confirmed ? 'primary-button' : 'secondary-button'}
                  type="button"
                  onClick={() => updateDepositPayment(payment.id, 'confirmed', !payment.confirmed)}
                >
                  {payment.confirmed ? '已對帳' : '待對帳'}
                </button>
                <button className="secondary-button" type="button" onClick={() => removeDepositPayment(payment.id)}>
                  移除
                </button>
              </div>
            ))}
          </div>
          <button className="secondary-button" type="button" onClick={addDepositPayment}>
            新增一筆付款
          </button>
        </section>

        <div className="form-actions">
          <button className="primary-button" disabled={saving || loadingAvailability}>
            {saving ? '建立中...' : '建立訂房訂單'}
          </button>
        </div>
      </form>
    </section>
  );
}

function CuteDatePicker({
  value,
  open,
  month,
  onToggle,
  onClose,
  onMoveMonth,
  onSelect,
}: {
  value: string;
  open: boolean;
  month: string;
  onToggle: () => void;
  onClose: () => void;
  onMoveMonth: (months: number) => void;
  onSelect: (date: string) => void;
}) {
  return (
    <div className="date-picker-wrap booking-date-picker-wrap">
      <button
        aria-expanded={open}
        className="date-control-input date-picker-trigger booking-date-picker-trigger"
        type="button"
        onClick={onToggle}
      >
        <b>{formatDisplayDate(value)}</b>
      </button>
      {open && (
        <CuteCalendar
          month={month}
          selectedDate={value}
          onClose={onClose}
          onMoveMonth={onMoveMonth}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}

function CuteCalendar({
  month,
  selectedDate,
  onClose,
  onMoveMonth,
  onSelect,
}: {
  month: string;
  selectedDate: string;
  onClose: () => void;
  onMoveMonth: (months: number) => void;
  onSelect: (date: string) => void;
}) {
  const monthDate = parseLocalDate(month);
  const year = monthDate.getFullYear();
  const monthIndex = monthDate.getMonth();
  const days = buildCalendarDays(month);

  return (
    <div className="cute-calendar" role="dialog" aria-label="選擇日期" onClick={(event) => event.stopPropagation()}>
      <div className="cute-calendar-head">
        <strong>{year}年{String(monthIndex + 1).padStart(2, '0')}月</strong>
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
      <div className="cute-calendar-actions">
        <button type="button" className="cute-calendar-today" onClick={() => onSelect(today)}>
          今天
        </button>
        <button
          type="button"
          className="cute-calendar-confirm"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }}
          aria-label="完成選擇日期"
        >
          <Check size={22} />
          <span>完成</span>
        </button>
      </div>
    </div>
  );
}

function datesBetween(start: string, end: string) {
  const dates: string[] = [];
  const current = parseLocalDate(start);
  const endDate = parseLocalDate(end);
  while (current < endDate) {
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

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: string, days: number) {
  const nextDate = parseLocalDate(date);
  nextDate.setDate(nextDate.getDate() + days);
  return formatLocalDate(nextDate);
}

function copyTextWithFallback(text: string) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  const success = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!success) throw new Error('copy failed');
}

function startOfMonth(date: string) {
  const parsed = parseLocalDate(date);
  return formatLocalDate(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
}

function addMonths(date: string, months: number) {
  const parsed = parseLocalDate(date);
  return formatLocalDate(new Date(parsed.getFullYear(), parsed.getMonth() + months, 1));
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

function getRateInfo(date: string, calendar: PriceCalendar[]): RateInfo {
  const override = calendar.find((item) => item.date === date);
  if (override) {
    return {
      category: override.rate_category,
      reason: override.label ? `價格日曆：${override.label}` : '價格日曆設定',
    };
  }

  const day = parseLocalDate(date).getDay();
  if (day === 6) return { category: 'saturday', reason: '系統自動：週六' };
  if (day === 5 || day === 0) return { category: 'friday_sunday_holiday', reason: '系統自動：週五或週日' };
  return { category: 'weekday', reason: '系統自動：週一到週四' };
}

function getRoomNightPrice(room: Room, date: string, rules: PriceRule[], calendar: PriceCalendar[]) {
  const customPrice = getCustomCalendarPrice(room.camp_id, room.room_type, date, calendar);
  if (customPrice !== null) return customPrice;

  const { category } = getRateInfo(date, calendar);
  const rule =
    rules.find((item) => item.camp_id === room.camp_id && item.room_type === room.room_type && item.rate_category === category) ??
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

function calculateRoomStayTotal(room: Room, dates: string[], rules: PriceRule[], calendar: PriceCalendar[]) {
  return dates.reduce((sum, date) => sum + getRoomNightPrice(room, date, rules, calendar), 0);
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

function summarizeStayRateSummary(items: Array<{ date: string; category: RateCategory; reason: string }>) {
  const groups: Array<{ start: string; end: string; category: RateCategory; reason: string }> = [];

  items.forEach((item) => {
    const latestGroup = groups[groups.length - 1];
    if (latestGroup && latestGroup.category === item.category && latestGroup.reason === item.reason) {
      latestGroup.end = item.date;
      return;
    }
    groups.push({ start: item.date, end: item.date, category: item.category, reason: item.reason });
  });

  return groups
    .map((group) => {
      const dateLabel =
        group.start === group.end
          ? formatMonthDayDisplay(group.start)
          : `${formatMonthDayDisplay(group.start)}-${formatMonthDayDisplay(group.end)}`;
      return `${dateLabel}：${rateCategoryLabel(group.category)}（${group.reason}）`;
    })
    .join('；');
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
  return labels[status];
}

function statusHint(status: BookingStatus) {
  if (status === 'awaiting_deposit_confirmation') return '已輸入末五碼，待銀行入帳確認';
  if (status === 'confirmed') return '訂金已確認入帳';
  return '尚未登記付款';
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0,
  }).format(price);
}

function valueToNonNegativeNumber(value: number | '') {
  return value === '' ? 0 : Math.max(Number(value || 0), 0);
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

function summarizeSelectedRoomTypes(rooms: Room[]) {
  const counts = new Map<string, number>();
  rooms.forEach((room) => {
    const roomType = room.room_type || '未設定房型';
    counts.set(roomType, (counts.get(roomType) ?? 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([roomType, count]) => `${roomType} x ${count}`)
    .join('、');
}

function buildPetSummary(smallPetCount: number, largePetCount: number) {
  const parts = [
    smallPetCount > 0 ? `小型犬 ${smallPetCount} 隻` : '',
    largePetCount > 0 ? `大型犬 ${largePetCount} 隻` : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join('、') : '無';
}

function buildExtraPersonSummary(extraPersonCount: number, extraPersonFeePerNight: number) {
  if (extraPersonCount <= 0) return '';
  return `加人：${extraPersonCount} 人，每人每晚 ${formatPrice(extraPersonFeePerNight)}`;
}

function buildCampCompletionMessage({
  campName,
  checkInDate,
  checkOutDate,
  rooms,
  guestName,
  guestPhone,
  petSummary,
  extraPersonSummary,
  totalAmount,
  transferAmount,
}: {
  campName: string;
  checkInDate: string;
  checkOutDate: string;
  rooms: string;
  guestName: string;
  guestPhone: string;
  petSummary: string;
  extraPersonSummary: string;
  totalAmount: number;
  transferAmount: number;
}) {
  const transferMemo = `${guestName}${formatMonthDay(checkInDate)}`;
  const isQiumu = campName === '秋慕嵐杉';
  const bankInfo = isQiumu
    ? `台灣中小企業銀行烏日分行050
帳號：483-62-229181
戶名：黃穆璿`
    : `中國信託高雄分行 822
帳號：037890023422
戶名：周景淳`;
  const petLine = isQiumu ? `寵物：${petSummary}` : '';
  const extraPersonLine = isQiumu && extraPersonSummary ? extraPersonSummary : '';
  const facilityNotice = isQiumu ? '🚨燈火如被包場設施暫停開放\n' : '';

  return `📝${campName || '燈火嵐杉'} 訂房通知

請核對資訊並24小時內完成匯訂
付訂完成才算完成訂房保留營位哦

━━━━━━━━━━━━━

💰 訂房明細確認
入住日：${formatDisplayDateWithWeekday(checkInDate)}
退房日：${formatDisplayDateWithWeekday(checkOutDate)}
房型：${rooms}
姓名：${guestName}
電話：${guestPhone || '未填電話'}
${petLine ? `${petLine}\n` : ''}${extraPersonLine ? `${extraPersonLine}\n` : ''}總計費用：${formatPrice(totalAmount)}
匯款金額：${formatPrice(transferAmount)}
匯款備註：${transferMemo}
‼️尾款住宿當天現金付清
（無提供其他付款方式）

━━━━━━━━━━━━━

匯款資訊 (請於24H內完成)
${bankInfo}

━━━━━━━━━━━━━

🕤入住資訊
入住：15:00後（最晚20:00）
退房：隔日上午11:00前
押金：入住時每房收$1,000，
退房無損壞有洗炊具會全退。

━━━━━━━━━━━━━

⚠️注意事項
🚫禁木炭、違法品
🚫私帶麥克風等擴音設備，
     不退押金並須賠償營業損失
${facilityNotice}📒入住14天內改期或房型，
      視同取消並酌收費用。
🛏️提供基本寢具，如需加被
      或加枕，每項 $200。

━━━━━━━━━━━━━

✍️ 匯款後請回傳以下資料
匯款金額：
匯款日期：
後五碼及截圖：`;
}

function formatDisplayDate(date: string) {
  if (!isValidDateString(date)) return date;
  return date.split('-').join('/');
}

function formatDisplayDateWithWeekday(date: string) {
  return `${formatDisplayDate(date)} ${weekdayLabel(date)}`;
}

function formatMonthDay(date: string) {
  const parsed = parseLocalDate(date);
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${month}${day}`;
}

function formatMonthDayDisplay(date: string) {
  const parsed = parseLocalDate(date);
  return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
}

function weekdayLabel(date: string) {
  return `週${'日一二三四五六'[parseLocalDate(date).getDay()]}`;
}
