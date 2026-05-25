import { FormEvent, useEffect, useMemo, useState } from 'react';
import { getRoomTypeLabel, sortRoomsByDisplayOrder } from '../lib/rooms';
import { supabase } from '../lib/supabase';
import type { BookingStatus, BookingWithRoom, Room } from '../types/database';

export type BookingFormValue = {
  room_id: string;
  guest_name: string;
  guest_phone: string;
  company_contact: string;
  check_in_date: string;
  check_out_date: string;
  status: BookingStatus;
  note: string;
};

type Props = {
  initialValue?: BookingWithRoom;
  submitLabel: string;
  onSubmit: (value: BookingFormValue) => Promise<void>;
};

const today = new Date().toISOString().slice(0, 10);

export function BookingForm({ initialValue, submitLabel, onSubmit }: Props) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<BookingFormValue>({
    room_id: initialValue?.room_id ?? '',
    guest_name: initialValue?.guest_name ?? '',
    guest_phone: initialValue?.guest_phone ?? '',
    company_contact: initialValue?.company_contact ?? '',
    check_in_date: initialValue?.check_in_date ?? today,
    check_out_date: initialValue?.check_out_date ?? today,
    status: initialValue?.status ?? 'confirmed',
    note: initialValue?.note ?? '',
  });

  useEffect(() => {
    async function loadRooms() {
      const { data, error: roomsError } = await supabase
        .from('rooms')
        .select('*')
        .eq('is_active', true)
        .order('name');
      if (roomsError) {
        setError(roomsError.message);
        return;
      }
      setRooms(sortRoomsByDisplayOrder(data ?? []));
      if (!form.room_id && data?.[0]) {
        setForm((current) => ({ ...current, room_id: data[0].id }));
      }
    }

    loadRooms();
  }, [form.room_id]);

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === form.room_id),
    [form.room_id, rooms],
  );

  function updateField<K extends keyof BookingFormValue>(key: K, value: BookingFormValue[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');

    try {
      if (form.check_out_date < form.check_in_date) {
        throw new Error('退房日期不可早於入住日期');
      }
      await onSubmit(form);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '儲存失敗');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={handleSubmit}>
      {error && <div className="form-error">{error}</div>}

      <label>
        房型
        <select value={form.room_id} onChange={(event) => updateField('room_id', event.target.value)} required>
          <option value="" disabled>
            選擇房間
          </option>
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {getRoomTypeLabel(room)} / {formatPrice(room.base_price)}
            </option>
          ))}
        </select>
      </label>

      <div className="field-preview">
        <span>固定房價</span>
        <strong>{selectedRoom ? formatPrice(selectedRoom.base_price) : '-'}</strong>
      </div>

      <label>
        住客姓名
        <input value={form.guest_name} onChange={(event) => updateField('guest_name', event.target.value)} required />
      </label>

      <label>
        住客電話
        <input value={form.guest_phone} onChange={(event) => updateField('guest_phone', event.target.value)} />
      </label>

      <label>
        公司窗口
        <input value={form.company_contact} onChange={(event) => updateField('company_contact', event.target.value)} />
      </label>

      <label>
        入住日期
        <input
          type="date"
          value={form.check_in_date}
          onChange={(event) => updateField('check_in_date', event.target.value)}
          required
        />
      </label>

      <label>
        退房日期
        <input
          type="date"
          value={form.check_out_date}
          onChange={(event) => updateField('check_out_date', event.target.value)}
          required
        />
      </label>

      <label>
        狀態
        <select value={form.status} onChange={(event) => updateField('status', event.target.value as BookingStatus)}>
          <option value="pending">未確認</option>
          <option value="awaiting_deposit_confirmation">待對帳</option>
          <option value="confirmed">已確認</option>
          <option value="checked_in">已入住</option>
          <option value="checked_out">已退房</option>
          <option value="cancelled">已取消</option>
        </select>
      </label>

      <label className="wide">
        備註
        <textarea value={form.note} onChange={(event) => updateField('note', event.target.value)} rows={4} />
      </label>

      <div className="form-actions wide">
        <button className="primary-button" disabled={saving || !form.room_id}>
          {saving ? '儲存中...' : submitLabel}
        </button>
      </div>
    </form>
  );
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0,
  }).format(price);
}
