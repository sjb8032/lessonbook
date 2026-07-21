"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function writeJournal(
  enrollmentId: string,
  bookingId: string | null,
  lessonDate: string,
  progress: string,
  notes: string,
  homework: string
) {
  const supabase = await createClient();
  const { error } = await supabase.from("journal_entries").insert({
    enrollment_id: enrollmentId,
    booking_id: bookingId,
    lesson_date: lessonDate,
    progress: progress || null,
    notes: notes || null,
    homework: homework || null,
  });
  revalidatePath("/t/students");
  revalidatePath("/s/me");
  return { error: error?.message ?? null };
}

export async function saveTeacherMemo(enrollmentId: string, memo: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("enrollments")
    .update({ teacher_memo: memo || null })
    .eq("id", enrollmentId);
  revalidatePath("/t/students");
  return { error: error?.message ?? null };
}

export async function saveSettings(form: {
  cycle_length: number;
  cycle_price: number;
  bank_info: string;
  payment_link: string;
  allow_student_cancel: boolean;
  allow_student_swap: boolean;
  swap_needs_approval: boolean;
  cancel_free_hours: number;
  book_free_hours: number;
  swap_free_hours: number;
  billing_day: number;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요해요" };
  if (
    form.cancel_free_hours < 0 ||
    form.book_free_hours < 0 ||
    form.swap_free_hours < 0
  ) {
    return { error: "기준 시간은 0 이상이어야 해요" };
  }
  if (form.billing_day < 1 || form.billing_day > 28) {
    return { error: "정산일은 1~28일 사이로 정해 주세요" };
  }
  const { error } = await supabase
    .from("teacher_settings")
    .update({
      cycle_length: form.cycle_length,
      cycle_price: form.cycle_price,
      bank_info: form.bank_info || null,
      payment_link: form.payment_link || null,
      allow_student_cancel: form.allow_student_cancel,
      allow_student_swap: form.allow_student_swap,
      swap_needs_approval: form.swap_needs_approval,
      cancel_free_hours: form.cancel_free_hours,
      book_free_hours: form.book_free_hours,
      swap_free_hours: form.swap_free_hours,
      billing_day: form.billing_day,
    })
    .eq("teacher_id", user.id);
  revalidatePath("/t/settings");
  revalidatePath("/t/schedule");
  revalidatePath("/t/settlement");
  revalidatePath("/s/schedule");
  return { error: error?.message ?? null };
}
