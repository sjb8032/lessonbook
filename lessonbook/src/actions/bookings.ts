"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function refresh() {
  revalidatePath("/t/schedule");
  revalidatePath("/s/schedule");
  revalidatePath("/s/me");
}

export async function bookSlot(slotId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("book_slot", { p_slot: slotId });
  refresh();
  return { error: error?.message ?? null };
}

export async function cancelBooking(bookingId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_booking", { p_booking: bookingId });
  refresh();
  return { error: error?.message ?? null };
}

export async function completeLesson(bookingId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_lesson", { p_booking: bookingId });
  refresh();
  revalidatePath("/t/students");
  return { error: error?.message ?? null };
}

export async function recordPayment(
  enrollmentId: string,
  amount: number,
  covers: number,
  note: string
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_payment", {
    p_enrollment: enrollmentId,
    p_amount: amount,
    p_covers: covers,
    p_note: note || null,
  });
  revalidatePath("/t/students");
  revalidatePath("/s/me");
  return { error: error?.message ?? null };
}
