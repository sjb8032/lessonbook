"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function requestSwap(
  myBookingId: string,
  targetBookingId: string,
  message: string
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_swap_request", {
    p_my_booking: myBookingId,
    p_target_booking: targetBookingId,
    p_message: message || null,
  });
  revalidatePath("/s/schedule");
  revalidatePath("/s/swaps");
  return { error: error?.message ?? null };
}

/** outcome: 'declined' | 'awaiting_teacher'(선생님 승인 대기) | 'accepted'(바로 성사) */
export async function respondSwap(swapId: string, accept: boolean) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("respond_swap", {
    p_swap: swapId,
    p_accept: accept,
  });
  revalidatePath("/s/schedule");
  revalidatePath("/s/swaps");
  revalidatePath("/t/requests");
  return { error: error?.message ?? null, outcome: data as string | null };
}

/** 선생님의 교환 최종 승인/반려 */
export async function respondSwapTeacher(swapId: string, accept: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_swap_teacher", {
    p_swap: swapId,
    p_accept: accept,
  });
  revalidatePath("/t/requests");
  revalidatePath("/t/schedule");
  revalidatePath("/s/schedule");
  revalidatePath("/s/swaps");
  return { error: error?.message ?? null };
}
