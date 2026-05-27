import { CheckCircle2 } from 'lucide-react';
import { FormEvent, Fragment, useEffect, useMemo, useState } from 'react';
import { ALL_CAMPS, useCamp } from '../contexts/CampContext';
import { createClientId } from '../lib/id';
import { bookingOrderStatusClass, bookingOrderStatusLabel } from '../lib/bookingStatus';
import { supabase } from '../lib/supabase';
import type { BookingOrder, InvoiceStatus } from '../types/database';

type DepositPayment = {
  id: string;
  paid_date: string;
  amount: number | '';
  last5: string;
  confirmed: boolean;
  note: string;
};

type DepositForm = {
  paid_date: string;
  amount: number | '';
  last5: string;
  note: string;
};

type FollowUpFilter = 'unpaid_deposit' | 'onsite_invoice' | 'all' | 'awaiting_deposit' | 'month_end_invoice' | 'cancellation_postponement';

export function FollowUpPage() {
  const { selectedCampId } = useCamp();
  const [orders, setOrders] = useState<BookingOrder[]>([]);
  const [activeFilter, setActiveFilter] = useState<FollowUpFilter>('all');
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [depositEditorOrder, setDepositEditorOrder] = useState<BookingOrder | null>(null);
  const [depositForm, setDepositForm] = useState<DepositForm>({
    paid_date: formatLocalDate(new Date()),
    amount: '',
    last5: '',
    note: '',
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadOrders();
  }, [selectedCampId]);

  async function loadOrders() {
    setLoading(true);
    setError('');

    let query = supabase
      .from('booking_orders')
      .select('*')
      .or('status.eq.pending,status.eq.awaiting_deposit_confirmation,cancellation_postponement.eq.true,invoice_status.eq.month_end,invoice_status.eq.onsite')
      .order('check_in_date', { ascending: true });

    if (selectedCampId !== ALL_CAMPS) {
      query = query.eq('camp_id', selectedCampId);
    }

    const { data, error: loadError } = await query;

    if (loadError) {
      setError(loadError.message);
    } else {
      setOrders((data ?? []).map((order) => ({ ...order, invoice_status: normalizeInvoiceStatus(order.invoice_status) })));
    }
    setLoading(false);
  }

  async function markInvoiceIssued(order: BookingOrder) {
    setError('');
    const { error: updateError } = await supabase
      .from('booking_orders')
      .update({ invoice_status: 'issued' })
      .eq('id', order.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    await loadOrders();
  }

  async function confirmDeposit(order: BookingOrder, paymentId?: string) {
    setError('');
    const now = new Date().toISOString();
    const parsedNote = getOrderPaymentInfo(order);
    const activePayments = parsedNote.payments.filter(isActiveDepositPayment);
    const targetPayment =
      activePayments.find((payment) => payment.id === paymentId) ??
      [...activePayments].reverse().find((payment) => !payment.confirmed) ??
      [...activePayments].reverse()[0];
    const nextPayments = parsedNote.payments.map((payment) =>
      targetPayment && payment.id === targetPayment.id ? { ...payment, confirmed: true } : payment,
    );
    const nextNote = buildOrderNote(parsedNote.baseNote, nextPayments.filter(isActiveDepositPayment));
    const nextActivePayments = nextPayments.filter(isActiveDepositPayment);
    const hasPendingPayment = nextActivePayments.some((payment) => !payment.confirmed);
    const nextStatus = hasPendingPayment ? 'awaiting_deposit_confirmation' : 'confirmed';

    const { error: orderError } = await supabase
      .from('booking_orders')
      .update({
        deposit_confirmed: !hasPendingPayment,
        deposit_confirmed_at: hasPendingPayment ? null : now,
        status: nextStatus,
        note: nextNote || null,
      })
      .eq('id', order.id);

    if (orderError) {
      setError(orderError.message);
      return;
    }

    const { error: bookingsError } = await supabase
      .from('bookings')
      .update({ status: nextStatus })
      .eq('order_id', order.id);

    if (bookingsError) {
      setError(bookingsError.message);
      return;
    }

    setExpandedOrderId(order.id);
    await loadOrders();
  }

  async function clearCancellationPostponement(order: BookingOrder) {
    setError('');
    const { error: updateError } = await supabase
      .from('booking_orders')
      .update({ cancellation_postponement: false })
      .eq('id', order.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    await loadOrders();
  }

  function openDepositEditor(order: BookingOrder) {
    setError('');
    setDepositEditorOrder(order);
    setDepositForm({
      paid_date: formatLocalDate(new Date()),
      amount: '',
      last5: '',
      note: '',
    });
  }

  async function addDepositPayment(event: FormEvent) {
    event.preventDefault();
    if (!depositEditorOrder) return;

    setError('');
    const amount = Number(depositForm.amount || 0);
    if (amount === 0 && !depositForm.last5.trim() && !depositForm.note.trim()) {
      setError('請至少輸入金額、末五碼或備註其中一項');
      return;
    }
    if (depositForm.last5.trim() && !/^\d{5}$/.test(depositForm.last5.trim())) {
      setError('訂金付款末五碼請輸入 5 位數字，或留空');
      return;
    }

    const parsedNote = getOrderPaymentInfo(depositEditorOrder);
    const nextPayments = [
      ...parsedNote.payments.filter(isActiveDepositPayment),
      {
        id: createClientId(),
        paid_date: depositForm.paid_date,
        amount: depositForm.amount,
        last5: depositForm.last5.trim(),
        confirmed: false,
        note: depositForm.note.trim(),
      },
    ];
    const nextDepositAmount = nextPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const latestLast5 = [...nextPayments].reverse().find((payment) => payment.last5.trim())?.last5.trim();
    const nextNote = buildOrderNote(parsedNote.baseNote, nextPayments);

    const { error: orderError } = await supabase
      .from('booking_orders')
      .update({
        deposit_amount: nextDepositAmount,
        balance_amount: Math.max(Number(depositEditorOrder.total_amount || 0) - nextDepositAmount, 0),
        deposit_payment_last5: latestLast5 || null,
        deposit_confirmed: false,
        deposit_confirmed_at: null,
        status: 'awaiting_deposit_confirmation',
        note: nextNote || null,
      })
      .eq('id', depositEditorOrder.id);

    if (orderError) {
      setError(orderError.message);
      return;
    }

    const { error: bookingsError } = await supabase
      .from('bookings')
      .update({ status: 'awaiting_deposit_confirmation' })
      .eq('order_id', depositEditorOrder.id);

    if (bookingsError) {
      setError(bookingsError.message);
      return;
    }

    setDepositEditorOrder(null);
    await loadOrders();
  }

  const summary = useMemo(
    () => ({
      unpaidDeposit: orders.filter((order) => order.status === 'pending').length,
      cancellationPostponement: orders.filter((order) => order.cancellation_postponement).length,
      awaitingDeposit: orders.filter((order) => order.status === 'awaiting_deposit_confirmation').length,
      monthEndInvoice: orders.filter((order) => order.invoice_status === 'month_end').length,
      onsiteInvoice: orders.filter((order) => order.invoice_status === 'onsite').length,
    }),
    [orders],
  );

  const filteredOrders = useMemo(() => {
    switch (activeFilter) {
      case 'unpaid_deposit':
        return orders.filter((order) => order.status === 'pending');
      case 'onsite_invoice':
        return orders.filter((order) => order.invoice_status === 'onsite');
      case 'awaiting_deposit':
        return orders.filter((order) => order.status === 'awaiting_deposit_confirmation');
      case 'month_end_invoice':
        return orders.filter((order) => order.invoice_status === 'month_end');
      case 'cancellation_postponement':
        return orders.filter((order) => order.cancellation_postponement);
      case 'all':
      default:
        return orders;
    }
  }, [activeFilter, orders]);

  const filterCards: Array<{
    key: FollowUpFilter;
    label: string;
    value: number;
    className?: string;
  }> = [
    { key: 'awaiting_deposit', label: '待對帳', value: summary.awaitingDeposit, className: 'metric-available' },
    { key: 'unpaid_deposit', label: '未付訂金', value: summary.unpaidDeposit },
    { key: 'onsite_invoice', label: '現場開立', value: summary.onsiteInvoice, className: 'metric-onsite' },
    { key: 'month_end_invoice', label: '月底開立', value: summary.monthEndInvoice },
    { key: 'cancellation_postponement', label: '取消延期', value: summary.cancellationPostponement },
    { key: 'all', label: '待處理訂單', value: orders.length },
  ];

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Follow up</p>
          <h1>待處理追蹤</h1>
        </div>
      </div>

      <div className="metric-grid follow-up-metric-grid">
        {filterCards.map((card) => (
          <button
            className={`metric metric-filter ${card.className ?? ''} ${activeFilter === card.key ? 'active' : ''}`}
            key={card.key}
            type="button"
            onClick={() => setActiveFilter(card.key)}
            aria-pressed={activeFilter === card.key}
          >
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </button>
        ))}
      </div>

      <div className="table-panel">
        {error && <div className="form-error">{error}</div>}
        {loading ? (
          <div className="empty-state">載入中...</div>
        ) : orders.length === 0 ? (
          <div className="empty-state">目前沒有未付訂金、待對帳、取消延期、月底開立或現場開立訂單</div>
        ) : filteredOrders.length === 0 ? (
          <div className="empty-state">這個分類目前沒有需要處理的訂單</div>
        ) : (
          <>
            <div className="mobile-card-list">
              {filteredOrders.map((order) => {
                const paymentInfo = getOrderPaymentInfo(order);
                const pendingPayments = paymentInfo.payments.filter((payment) => isActiveDepositPayment(payment) && !payment.confirmed);
                const pendingPaymentAmount = pendingPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
                const latestPendingLast5 = [...pendingPayments].reverse().find((payment) => payment.last5.trim())?.last5.trim();
                const isExpanded = expandedOrderId === order.id;

                return (
                  <MobileFollowUpCard
                    isExpanded={isExpanded}
                    key={`follow-up-card-${order.id}`}
                    latestPendingLast5={latestPendingLast5}
                    onAddDeposit={openDepositEditor}
                    onClearCancellation={clearCancellationPostponement}
                    onConfirmDeposit={confirmDeposit}
                    onExpand={(nextExpanded) => setExpandedOrderId(nextExpanded ? order.id : null)}
                    onMarkInvoiceIssued={markInvoiceIssued}
                    order={order}
                    paymentInfo={paymentInfo}
                    pendingPaymentAmount={pendingPaymentAmount}
                    pendingPayments={pendingPayments}
                  />
                );
              })}
            </div>
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
                  <th>末五碼</th>
                  <th>入帳</th>
                  <th>取消延期</th>
                  <th>發票需求</th>
                  <th>發票備註</th>
                  <th>狀態</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => {
                  const paymentInfo = getOrderPaymentInfo(order);
                  const pendingPayments = paymentInfo.payments.filter((payment) => isActiveDepositPayment(payment) && !payment.confirmed);
                  const pendingPaymentAmount = pendingPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
                  const latestPendingLast5 = [...pendingPayments].reverse().find((payment) => payment.last5.trim())?.last5.trim();
                  const isExpanded = expandedOrderId === order.id;

                  return (
                    <Fragment key={order.id}>
                      <tr>
                        <td>{formatCompactDate(order.check_in_date)}</td>
                        <td>{formatCompactDate(order.check_out_date)}</td>
                        <td>
                          <strong>{order.guest_name}</strong>
                          <span className="subtext">{order.guest_phone || '未填電話'}</span>
                        </td>
                        <td>{order.room_count} 間</td>
                        <td>{formatPrice(order.total_amount)}</td>
                        <td>
                          <strong>{pendingPayments.length > 0 ? formatPrice(pendingPaymentAmount) : '-'}</strong>
                          {pendingPayments.length > 0 && <span className="subtext">待對帳 {pendingPayments.length} 筆</span>}
                        </td>
                        <td>{latestPendingLast5 || '-'}</td>
                        <td>{order.deposit_confirmed ? '已入帳' : '未確認'}</td>
                        <td>{order.cancellation_postponement ? '需要處理' : '-'}</td>
                        <td>{renderInvoiceStatus(normalizeInvoiceStatus(order.invoice_status))}</td>
                        <td>{order.invoice_note || '-'}</td>
                        <td>
                          <span className={`status ${bookingOrderStatusClass(order)}`}>
                            {bookingOrderStatusLabel(order)}
                          </span>
                        </td>
                        <td>
                          <div className="inline-actions">
                            {paymentInfo.payments.some(isActiveDepositPayment) && (
                              <button
                                className="secondary-button"
                                onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                              >
                                {isExpanded ? '收合付款紀錄' : '查看付款紀錄'}
                              </button>
                            )}
                            {order.status === 'pending' && (
                              <button className="secondary-button" onClick={() => openDepositEditor(order)}>
                                新增訂金
                              </button>
                            )}
                            {pendingPayments.length > 0 && (
                              <button
                                className="secondary-button"
                                onClick={() => confirmDeposit(order, [...pendingPayments].reverse()[0].id)}
                              >
                                <CheckCircle2 size={16} />
                                {pendingPayments.length > 1 ? '確認最新待對帳' : '確認入帳'}
                              </button>
                            )}
                            {order.cancellation_postponement && (
                              <button className="secondary-button" onClick={() => clearCancellationPostponement(order)}>
                                <CheckCircle2 size={16} />
                                取消延期已處理
                              </button>
                            )}
                            {(order.invoice_status === 'month_end' || order.invoice_status === 'onsite') && (
                              <button className="secondary-button" onClick={() => markInvoiceIssued(order)}>
                                <CheckCircle2 size={16} />
                                標記已開發票
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${order.id}-payments`} className="payment-detail-row">
                          <td colSpan={13}>
                            <PaymentDetails order={order} payments={paymentInfo.payments} onConfirmPayment={confirmDeposit} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            </div>
          </>
        )}
      </div>

      {depositEditorOrder && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal compact-modal">
            <div className="modal-header">
              <div>
                <p className="eyebrow">Deposit payment</p>
                <h2>新增訂金</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setDepositEditorOrder(null)} title="關閉">
                ×
              </button>
            </div>
            <form className="form-grid" onSubmit={addDepositPayment}>
              <label>
                住客
                <input value={depositEditorOrder.guest_name} readOnly />
              </label>
              <label>
                訂單總額
                <input value={formatPrice(depositEditorOrder.total_amount)} readOnly />
              </label>
              <label>
                付款日期
                <input
                  type="date"
                  value={depositForm.paid_date}
                  onChange={(event) => setDepositForm((current) => ({ ...current, paid_date: event.target.value }))}
                />
              </label>
              <label>
                金額
                <input
                  type="number"
                  value={depositForm.amount}
                  onChange={(event) =>
                    setDepositForm((current) => ({
                      ...current,
                      amount: event.target.value === '' ? '' : Number(event.target.value || 0),
                    }))
                  }
                  placeholder="例如 3000"
                />
              </label>
              <label>
                末五碼
                <input
                  value={depositForm.last5}
                  onChange={(event) =>
                    setDepositForm((current) => ({ ...current, last5: event.target.value.replace(/\D/g, '').slice(0, 5) }))
                  }
                  placeholder="例如 12345"
                />
              </label>
              <label>
                備註
                <input
                  value={depositForm.note}
                  onChange={(event) => setDepositForm((current) => ({ ...current, note: event.target.value }))}
                  placeholder="例如 匯款截圖已收到"
                />
              </label>
              <button className="primary-button" type="submit">
                儲存訂金
              </button>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}

function MobileFollowUpCard({
  order,
  paymentInfo,
  pendingPayments,
  pendingPaymentAmount,
  latestPendingLast5,
  isExpanded,
  onExpand,
  onAddDeposit,
  onConfirmDeposit,
  onClearCancellation,
  onMarkInvoiceIssued,
}: {
  order: BookingOrder;
  paymentInfo: ReturnType<typeof getOrderPaymentInfo>;
  pendingPayments: DepositPayment[];
  pendingPaymentAmount: number;
  latestPendingLast5?: string;
  isExpanded: boolean;
  onExpand: (nextExpanded: boolean) => void;
  onAddDeposit: (order: BookingOrder) => void;
  onConfirmDeposit: (order: BookingOrder, paymentId: string) => void;
  onClearCancellation: (order: BookingOrder) => void;
  onMarkInvoiceIssued: (order: BookingOrder) => void;
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
          <span>待對帳：{pendingPayments.length > 0 ? formatPrice(pendingPaymentAmount) : '-'}</span>
          <span>末五碼：{latestPendingLast5 || '-'}</span>
          <span>房間：{order.room_count} 間</span>
          <span>發票備註：{order.invoice_note || '-'}</span>
        </div>
        <div className="mobile-order-card-side">
          <span>發票需求</span>
          <div className="mobile-order-card-side-box">{renderInvoiceStatus(normalizeInvoiceStatus(order.invoice_status))}</div>
          <span>狀態</span>
          <span className={`status mobile-card-status ${bookingOrderStatusClass(order)}`}>
            {bookingOrderStatusLabel(order)}
          </span>
          <div className="mobile-order-card-actions">
            {paymentInfo.payments.some(isActiveDepositPayment) && (
              <button className="secondary-button" onClick={() => onExpand(!isExpanded)}>
                {isExpanded ? '收合付款紀錄' : '查看付款紀錄'}
              </button>
            )}
            {order.status === 'pending' && (
              <button className="secondary-button" onClick={() => onAddDeposit(order)}>
                新增訂金
              </button>
            )}
            {pendingPayments.length > 0 && (
              <button className="secondary-button" onClick={() => onConfirmDeposit(order, [...pendingPayments].reverse()[0].id)}>
                <CheckCircle2 size={16} />
                確認入帳
              </button>
            )}
            {order.cancellation_postponement && (
              <button className="secondary-button" onClick={() => onClearCancellation(order)}>
                <CheckCircle2 size={16} />
                取消延期已處理
              </button>
            )}
            {(order.invoice_status === 'month_end' || order.invoice_status === 'onsite') && (
              <button className="secondary-button" onClick={() => onMarkInvoiceIssued(order)}>
                <CheckCircle2 size={16} />
                標記已開發票
              </button>
            )}
          </div>
        </div>
        <div className="mobile-order-card-note">訂單備註：{cleanNoteForDisplay(order.note)}</div>
      </div>
      {isExpanded && <PaymentDetails order={order} payments={paymentInfo.payments} onConfirmPayment={onConfirmDeposit} />}
    </article>
  );
}

function PaymentDetails({
  order,
  payments,
  onConfirmPayment,
}: {
  order: BookingOrder;
  payments: DepositPayment[];
  onConfirmPayment: (order: BookingOrder, paymentId: string) => void;
}) {
  const activePayments = payments.filter(isActiveDepositPayment);
  if (activePayments.length === 0) {
    return <div className="empty-state compact-empty">沒有訂金付款紀錄</div>;
  }

  return (
    <div className="payment-detail-panel">
      <div className="payment-detail-heading">
        <strong>訂金付款紀錄</strong>
        <span className="subtext">可在這裡確認單筆入帳</span>
      </div>
      <div className="payment-detail-grid">
        {activePayments.map((payment, index) => (
          <article className="payment-detail-card" key={payment.id}>
            <div>
              <span className="subtext">第 {index + 1} 筆</span>
              <strong>{formatPrice(Number(payment.amount || 0))}</strong>
            </div>
            <div>
              <span className="subtext">付款日期</span>
              <strong>{payment.paid_date}</strong>
            </div>
            <div>
              <span className="subtext">末五碼</span>
              <strong>{payment.last5 || '-'}</strong>
            </div>
            <div>
              <span className={`status ${payment.confirmed ? 'status-confirmed' : 'status-awaiting_deposit_confirmation'}`}>
                {payment.confirmed ? '已對帳' : '待對帳'}
              </span>
            </div>
            <div className="payment-detail-note">
              <span className="subtext">備註</span>
              <strong>{payment.note || '-'}</strong>
            </div>
            {!payment.confirmed && (
              <button className="secondary-button" onClick={() => onConfirmPayment(order, payment.id)}>
                <CheckCircle2 size={16} />
                確認此筆
              </button>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

function getOrderPaymentInfo(order: BookingOrder) {
  return splitOrderNoteAndPayments(
    order.note ?? '',
    Number(order.deposit_amount || 0),
    order.deposit_payment_last5,
    order.deposit_confirmed,
  );
}

function splitOrderNoteAndPayments(note: string, depositAmount: number, last5: string | null, depositConfirmed = false) {
  const marker = '訂金付款紀錄：';
  const markerIndex = note.indexOf(marker);
  const fallbackPayment: DepositPayment = {
    id: 'legacy-payment',
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
    .map((line, index) => parsePaymentLine(line, index))
    .filter((payment): payment is DepositPayment => Boolean(payment));

  return {
    baseNote,
    payments: payments.length > 0 ? payments : [fallbackPayment],
  };
}

function parsePaymentLine(line: string, index: number): DepositPayment | null {
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
    id: `payment-${index}`,
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
  return { id: 'empty-payment', paid_date: formatLocalDate(new Date()), amount: '', last5: '', confirmed: false, note: '' };
}

function isActiveDepositPayment(payment: DepositPayment) {
  return Number(payment.amount || 0) !== 0 || payment.last5.trim() || payment.note.trim();
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

function parseLocalDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
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

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
