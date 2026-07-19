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
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요해요" };
  const { error } = await supabase
    .from("teacher_settings")
    .update({
      cycle_length: form.cycle_length,
      cycle_price: form.cycle_price,
      bank_info: form.bank_info || null,
      payment_link: form.payment_link || null,
    })
    .eq("teacher_id", user.id);
  revalidatePath("/t/settings");
  return { error: error?.message ?? null };
}
