"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function refresh() {
  revalidatePath("/t/schedule");
  revalidatePath("/t/requests");
  revalidatePath("/s/schedule");
  revalidatePath("/s/me");
}

/** outcome: 'confirmed'(바로 확정) | 'pending'(선생님 승인 대기) */
export async function bookSlot(slotId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("book_slot", { p_slot: slotId });
  refresh();
  return { error: error?.message ?? null, outcome: data as string | null };
}

/** outcome: 'canceled'(바로 취소됨) | 'requested'(선생님 승인 대기) */
export async function cancelBooking(bookingId: string, reason?: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_booking", {
    p_booking: bookingId,
    p_reason: reason || null,
  });
  refresh();
  return { error: error?.message ?? null, outcome: data as string | null };
}

/** 선생님이 예약 신청을 승인/반려 */
export async function respondBooking(bookingId: string, accept: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_booking", {
    p_booking: bookingId,
    p_accept: accept,
  });
  refresh();
  return { error: error?.message ?? null };
}

/** 선생님이 취소 요청을 승인/반려 */
export async function respondCancel(bookingId: string, accept: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_cancel", {
    p_booking: bookingId,
    p_accept: accept,
  });
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
