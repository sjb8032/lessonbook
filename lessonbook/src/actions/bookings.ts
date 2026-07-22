"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function refresh() {
  revalidatePath("/t/schedule");
  revalidatePath("/t/requests");
  revalidatePath("/s/schedule");
  revalidatePath("/s/me");
}

/** outcome: 'confirmed'(바로 확정) | 'pending'(선생님 승인 대기)
 *  kind: 학생이 이 시간을 무엇으로 쓸지 (수업/녹음/체험)
 *  classId: 반 제한 없는 수업을 여러 반 소속 학생이 예약할 때 어느 반으로 잡을지 */
export async function bookSlot(
  slotId: string,
  classId?: string,
  kind: "lesson" | "recording" | "trial" = "lesson"
) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("book_slot", {
    p_slot: slotId,
    p_class: classId ?? null,
    p_kind: kind,
  });
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

