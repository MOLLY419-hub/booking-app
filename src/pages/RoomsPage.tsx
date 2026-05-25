import { FormEvent, useEffect, useState } from 'react';
import { ALL_CAMPS, useCamp } from '../contexts/CampContext';
import { sortRoomsByDisplayOrder } from '../lib/rooms';
import { supabase } from '../lib/supabase';
import type { Room } from '../types/database';

type RoomForm = {
  name: string;
  room_type: string;
  capacity: number;
  base_price: number;
};

export function RoomsPage() {
  const { camps, selectedCampId } = useCamp();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<RoomForm>({
    name: '',
    room_type: '',
    capacity: 2,
    base_price: 0,
  });

  useEffect(() => {
    loadRooms();
  }, [selectedCampId]);

  async function loadRooms() {
    setLoading(true);
    let query = supabase.from('rooms').select('*').order('name');
    if (selectedCampId !== ALL_CAMPS) {
      query = query.eq('camp_id', selectedCampId);
    }
    const { data, error: loadError } = await query;
    if (loadError) {
      setError(loadError.message);
    } else {
      setRooms(sortRoomsByDisplayOrder(data ?? []));
    }
    setLoading(false);
  }

  async function createRoom(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const campId = selectedCampId !== ALL_CAMPS ? selectedCampId : camps[0]?.id;
    if (!campId) {
      setError('請先選擇營區');
      setSaving(false);
      return;
    }

    const { error: insertError } = await supabase.from('rooms').insert({
      camp_id: campId,
      name: form.name.trim(),
      room_type: form.room_type.trim() || null,
      capacity: form.capacity,
      base_price: form.base_price,
      is_active: true,
    });

    if (insertError) {
      setError(insertError.message);
    } else {
      setForm({ name: '', room_type: '', capacity: 2, base_price: 0 });
      await loadRooms();
    }
    setSaving(false);
  }

  async function toggleRoom(room: Room) {
    const { error: updateError } = await supabase
      .from('rooms')
      .update({ is_active: !room.is_active })
      .eq('id', room.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    await loadRooms();
  }

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Rooms</p>
          <h1>房間管理</h1>
        </div>
      </div>

      <div className="form-panel">
        <form className="form-grid room-form" onSubmit={createRoom}>
          {error && <div className="form-error">{error}</div>}
          <label>
            房號 / 房名
            <input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="例如 A101"
              required
            />
          </label>
          <label>
            房型
            <input
              value={form.room_type}
              onChange={(event) => setForm((current) => ({ ...current, room_type: event.target.value }))}
              placeholder="例如 標準雙人房"
            />
          </label>
          <label>
            人數
            <input
              min={1}
              type="number"
              value={form.capacity}
              onChange={(event) =>
                setForm((current) => ({ ...current, capacity: Number(event.target.value || 1) }))
              }
              required
            />
          </label>
          <label>
            固定房價
            <input
              min={0}
              step={100}
              type="number"
              value={form.base_price}
              onChange={(event) =>
                setForm((current) => ({ ...current, base_price: Number(event.target.value || 0) }))
              }
              required
            />
          </label>
          <div className="form-actions wide">
            <button className="primary-button" disabled={saving}>
              {saving ? '新增中...' : '新增房間'}
            </button>
          </div>
        </form>
      </div>

      <div className="table-panel">
        {loading ? (
          <div className="empty-state">載入中...</div>
        ) : rooms.length === 0 ? (
          <div className="empty-state">尚未建立房間</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>房號</th>
                  <th>房型</th>
                  <th>人數</th>
                  <th>固定房價</th>
                  <th>狀態</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((room) => (
                  <tr key={room.id}>
                    <td>
                      <strong>{room.name}</strong>
                    </td>
                    <td>{room.room_type || '-'}</td>
                    <td>{room.capacity}</td>
                    <td>{formatPrice(room.base_price)}</td>
                    <td>
                      <span className={`status ${room.is_active ? 'status-checked_in' : 'status-cancelled'}`}>
                        {room.is_active ? '啟用' : '停用'}
                      </span>
                    </td>
                    <td>
                      <button className="secondary-button" onClick={() => toggleRoom(room)}>
                        {room.is_active ? '停用' : '啟用'}
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

function formatPrice(price: number) {
  return new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0,
  }).format(price);
}
