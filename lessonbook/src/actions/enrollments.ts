"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** 선생님이 수강 연결 신청을 승인/거절. 승인 시 반을 함께 배정할 수 있다 */
export async function respondEnrollment(
  enrollmentId: string,
  accept: boolean,
  classIds: string[] = []
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_enrollment", {
    p_enrollment: enrollmentId,
    p_accept: accept,
    p_class_ids: classIds,
  });
  revalidatePath("/t/requests");
  revalidatePath("/t/students");
  revalidatePath("/t/classes");
  revalidatePath("/t/settlement");
  revalidatePath("/s/schedule");
  return { error: error?.message ?? null };
}
