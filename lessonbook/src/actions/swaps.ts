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

export async function respondSwap(swapId: string, accept: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_swap", {
    p_swap: swapId,
    p_accept: accept,
  });
  revalidatePath("/s/schedule");
  revalidatePath("/s/swaps");
  return { error: error?.message ?? null };
}
