type BookingStatusLike = {
  status: string;
  cancellation_postponement?: boolean | null;
};

const STATUS_LABELS: Record<string, string> = {
  pending: '未確認',
  awaiting_deposit_confirmation: '待對帳',
  confirmed: '已確認',
  checked_in: '已入住',
  checked_out: '已退房',
  cancelled: '已取消',
};

export function bookingStatusLabel(status: string) {
  return STATUS_LABELS[status] ?? status;
}

export function bookingOrderStatusLabel(order: BookingStatusLike) {
  if (order.cancellation_postponement) return '取消延期';
  return bookingStatusLabel(order.status);
}

export function bookingOrderStatusClass(order: BookingStatusLike) {
  if (order.cancellation_postponement) return 'status-cancellation_postponement';
  return `status-${order.status}`;
}
