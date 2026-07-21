"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function refresh() {
  revalidatePath("/t/settlement");
  revalidatePath("/t/students");
  revalidatePath("/s/me");
}

/** 월 정산 — 이번 창 입금 확인 체크 */
export async function confirmSettlement(classId: string, enrollmentId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_settlement", {
    p_class: classId,
    p_enrollment: enrollmentId,
  });
  refresh();
  return { error: error?.message ?? null };
}

/** 월 정산 — 입금 확인 취소 (잘못 눌렀을 때) */
export async function cancelSettlement(classId: string, enrollmentId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_settlement", {
    p_class: classId,
    p_enrollment: enrollmentId,
  });
  refresh();
  return { error: error?.message ?? null };
}

/** 선불 — N회분 충전(입금 확인) */
export async function addPrepay(
  classId: string,
  enrollmentId: string,
  sessions: number
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_prepay", {
    p_class: classId,
    p_enrollment: enrollmentId,
    p_sessions: sessions,
  });
  refresh();
  return { error: error?.message ?? null };
}
