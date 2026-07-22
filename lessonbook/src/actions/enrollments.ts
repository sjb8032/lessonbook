"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** 선생님이 수강 연결 신청을 승인/거절 */
export async function respondEnrollment(enrollmentId: string, accept: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_enrollment", {
    p_enrollment: enrollmentId,
    p_accept: accept,
  });
  revalidatePath("/t/requests");
  revalidatePath("/t/students");
  revalidatePath("/t/classes");
  revalidatePath("/s/schedule");
  return { error: error?.message ?? null };
}
