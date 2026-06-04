export type UserRole = 'admin' | 'staff' | 'viewer';
export type BookingStatus =
  | 'pending'
  | 'awaiting_deposit_confirmation'
  | 'confirmed'
  | 'checked_in'
  | 'checked_out'
  | 'cancelled';
export type RateCategory = 'weekday' | 'friday_sunday_holiday' | 'saturday' | 'consecutive_holiday';
export type InvoiceStatus = 'none' | 'month_end' | 'onsite' | 'issued';

export type Profile = {
  id: string;
  full_name: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
};

export type Camp = {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
};

export type Room = {
  id: string;
  camp_id: string | null;
  name: string;
  room_type: string | null;
  capacity: number;
  base_price: number;
  is_active: boolean;
  created_at: string;
};

export type Booking = {
  id: string;
  order_id: string | null;
  room_id: string;
  guest_name: string;
  guest_phone: string | null;
  company_contact: string | null;
  check_in_date: string;
  check_out_date: string;
  room_price: number;
  status: BookingStatus;
  note: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type BookingOrder = {
  id: string;
  camp_id: string | null;
  guest_name: string;
  guest_phone: string | null;
  company_contact: string | null;
  check_in_date: string;
  check_out_date: string;
  room_count: number;
  small_pet_count: number;
  large_pet_count: number;
  small_pet_fee_per_night: number;
  large_pet_fee_per_night: number;
  extra_person_count: number;
  extra_person_fee_per_night: number;
  total_amount: number;
  deposit_amount: number;
  balance_amount: number;
  deposit_payment_last5: string | null;
  deposit_confirmed: boolean;
  deposit_confirmed_at: string | null;
  cancellation_postponement: boolean;
  invoice_status: InvoiceStatus;
  invoice_note: string | null;
  status: BookingStatus;
  note: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type BookingWithRoom = Booking & {
  rooms: Pick<Room, 'id' | 'camp_id' | 'name' | 'room_type' | 'base_price'> | null;
};

export type BookingOrderWithBookings = BookingOrder & {
  bookings: BookingWithRoom[];
};

export type PriceRule = {
  id: string;
  camp_id: string | null;
  room_type: string;
  rate_category: RateCategory;
  price: number;
  created_at: string;
  updated_at: string;
};

export type PriceCalendar = {
  camp_id: string | null;
  date: string;
  rate_category: RateCategory;
  label: string | null;
  custom_prices: Record<string, number | null> | null;
  created_at: string;
};

export type DailyHandoff = {
  id: string;
  camp_id: string | null;
  date: string;
  note: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Database = {
  public: {
    Tables: {
      camps: {
        Row: Camp;
        Insert: Omit<Camp, 'id' | 'created_at'> & { id?: string };
        Update: Partial<Omit<Camp, 'id' | 'created_at'>>;
        Relationships: [];
      };
      profiles: {
        Row: Profile;
        Insert: Partial<Omit<Profile, 'created_at' | 'updated_at'>> & { id: string };
        Update: Partial<Omit<Profile, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [];
      };
      rooms: {
        Row: Room;
        Insert: Omit<Room, 'id' | 'created_at'> & { id?: string };
        Update: Partial<Omit<Room, 'id' | 'created_at'>>;
        Relationships: [];
      };
      booking_orders: {
        Row: BookingOrder;
        Insert: Omit<BookingOrder, 'id' | 'created_at' | 'updated_at'> & { id?: string };
        Update: Partial<Omit<BookingOrder, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [];
      };
      price_rules: {
        Row: PriceRule;
        Insert: Omit<PriceRule, 'id' | 'created_at' | 'updated_at'> & { id?: string };
        Update: Partial<Omit<PriceRule, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [];
      };
      price_calendar: {
        Row: PriceCalendar;
        Insert: Omit<PriceCalendar, 'created_at'>;
        Update: Partial<Omit<PriceCalendar, 'date' | 'created_at'>>;
        Relationships: [];
      };
      daily_handoffs: {
        Row: DailyHandoff;
        Insert: Omit<DailyHandoff, 'id' | 'created_at' | 'updated_at'> & { id?: string };
        Update: Partial<Omit<DailyHandoff, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [];
      };
      bookings: {
        Row: Booking;
        Insert: Omit<Booking, 'id' | 'created_at' | 'updated_at'> & { id?: string };
        Update: Partial<Omit<Booking, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [
          {
            foreignKeyName: 'bookings_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'booking_orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_room_id_fkey';
            columns: ['room_id'];
            isOneToOne: false;
            referencedRelation: 'rooms';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      delete_booking_order: {
        Args: { target_order_id: string };
        Returns: void;
      };
    };
    Enums: {
      app_role: UserRole;
      booking_status: BookingStatus;
      rate_category: RateCategory;
    };
  };
};
