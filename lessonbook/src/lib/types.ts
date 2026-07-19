export type Role = "teacher" | "student";

export type Profile = {
  id: string;
  role: Role;
  name: string;
  phone: string | null;
};

export type TeacherSettings = {
  teacher_id: string;
  lesson_minutes: number;
  cycle_length: number;
  cycle_price: number;
  bank_info: string | null;
  payment_link: string | null;
  join_code: string;
  allow_student_cancel: boolean;
  allow_student_swap: boolean;
  swap_needs_approval: boolean;
  cancel_free_hours: number;
  book_free_hours: number;
  swap_free_hours: number;
};

/** 학생 화면에서 "지금 이 동작이 즉시 되는지 / 승인이 필요한지" 판단에 쓰는 값들 */
export type BookingPolicy = {
  allow_student_cancel: boolean;
  allow_student_swap: boolean;
  swap_needs_approval: boolean;
  cancel_free_hours: number;
  book_free_hours: number;
  swap_free_hours: number;
};

export type BookingStatus = "pending" | "confirmed" | "completed";

export type ScheduleRow = {
  slot_id: string;
  starts_at: string;
  ends_at: string;
  slot_status: "open" | "booked";
  booking_id: string | null;
  is_mine: boolean | null;
  student_label: string | null;
  enrollment_id: string | null;
  session_done: boolean | null;
  booking_status: BookingStatus | null;
  cancel_requested: boolean | null;
};

export type TeacherRequest = {
  kind: "booking" | "cancel" | "swap";
  ref_id: string;
  starts_at: string;
  other_time: string | null;
  who: string;
  message: string | null;
  created_at: string;
};

export type StudentOverview = {
  enrollment_id: string;
  student_id: string;
  student_name: string;
  phone: string | null;
  started_at: string;
  completed: number;
  paid: number;
  balance: number;
  cycle_length: number;
  cycle_price: number;
  last_lesson: string | null;
  teacher_memo: string | null;
};

export type JournalEntry = {
  id: string;
  lesson_date: string;
  progress: string | null;
  notes: string | null;
  homework: string | null;
  created_at: string;
};

export type Payment = {
  id: string;
  amount: number;
  covers_sessions: number;
  note: string | null;
  paid_at: string;
};
