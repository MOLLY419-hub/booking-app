import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

const today = formatLocalDate(new Date());

type CuteDateNavigatorProps = {
  value: string;
  onChange: (date: string) => void;
  onMove: (days: number) => void;
  label?: string;
  previousLabel?: string;
  nextLabel?: string;
  previousDays?: number;
  nextDays?: number;
  children?: ReactNode;
};

export function CuteDateNavigator({
  value,
  onChange,
  onMove,
  label = '查看日期',
  previousLabel = '前一天',
  nextLabel = '後一天',
  previousDays = -1,
  nextDays = 1,
  children,
}: CuteDateNavigatorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [month, setMonth] = useState(() => startOfMonth(value));

  useEffect(() => {
    setMonth(startOfMonth(value));
  }, [value]);

  function selectDate(nextDate: string) {
    onChange(nextDate);
    setMonth(startOfMonth(nextDate));
    setIsOpen(false);
  }

  function moveMonth(months: number) {
    const next = parseLocalDate(month);
    next.setMonth(next.getMonth() + months);
    setMonth(formatLocalDate(next));
  }

  return (
    <div className="date-control-panel cute-date-control-panel">
      <div className="date-control-bar cute-date-control-bar">
        <span className="date-control-label">{label}</span>
        <button className="secondary-button date-nav-button" type="button" onClick={() => onMove(previousDays)}>
          <ChevronLeft size={18} />
          {previousLabel}
        </button>
        <div className="date-picker-wrap">
          <button
            className="date-control-input date-picker-trigger"
            type="button"
            onClick={() => setIsOpen((current) => !current)}
          >
            <b>{formatDisplayDate(value)}</b>
          </button>
          {isOpen && (
            <CuteCalendar
              month={month}
              selectedDate={value}
              onClose={() => setIsOpen(false)}
              onMoveMonth={moveMonth}
              onSelect={selectDate}
            />
          )}
        </div>
        <button className="secondary-button date-nav-button" type="button" onClick={() => onMove(nextDays)}>
          {nextLabel}
          <ChevronRight size={18} />
        </button>
        {children}
      </div>
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
  const monthLabel = `${monthDate.getFullYear()}年${String(monthDate.getMonth() + 1).padStart(2, '0')}月`;
  const days = buildCalendarDays(month);

  return (
    <div className="cute-calendar" role="dialog" aria-label="選擇日期" onClick={(event) => event.stopPropagation()}>
      <div className="cute-calendar-head">
        <strong>{monthLabel}</strong>
        <div>
          <button type="button" onClick={() => onMoveMonth(-1)} aria-label="上一個月">
            <ChevronLeft size={18} />
          </button>
          <button type="button" onClick={() => onMoveMonth(1)} aria-label="下一個月">
            <ChevronRight size={18} />
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

function startOfMonth(date: string) {
  const parsed = parseLocalDate(date);
  return formatLocalDate(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
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

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDisplayDate(date: string) {
  const [year, month, day] = date.split('-');
  return `${year}/${month}/${day}`;
}
