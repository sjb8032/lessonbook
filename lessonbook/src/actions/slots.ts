"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function openSlot(startsAtISO: string, minutes: number) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요해요" };

  const ends = new Date(new Date(startsAtISO).getTime() + minutes * 60 * 1000);
  const { error } = await supabase.from("slots").insert({
    teacher_id: user.id,
    starts_at: startsAtISO,
    ends_at: ends.toISOString(),
  });
  revalidatePath("/t/schedule");
  return { error: error?.message ?? null };
}

export async function closeSlot(slotId: string) {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("slots")
    .delete({ count: "exact" })
    .eq("id", slotId)
    .eq("status", "open");
  revalidatePath("/t/schedule");
  if (!error && count === 0)
    return { error: "예약된 시간은 닫을 수 없어요. 먼저 예약을 취소해 주세요" };
  return { error: error?.message ?? null };
}

export async function copyWeek(fromISO: string, toISO: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("copy_week_slots", {
    p_from: fromISO,
    p_to: toISO,
  });
  revalidatePath("/t/schedule");
  if (error) return { error: error.message, copied: 0 };
  return { error: null, copied: data as number };
}
