"use server";

import { createClient } from "@/lib/supabase/server";

export async function setupTeacher(name: string, phone: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요해요" };

  const { error: pErr } = await supabase
    .from("profiles")
    .insert({ id: user.id, role: "teacher", name, phone: phone || null });
  if (pErr) return { error: pErr.message };

  const { error: sErr } = await supabase
    .from("teacher_settings")
    .insert({ teacher_id: user.id });
  if (sErr) return { error: sErr.message };

  return { error: null };
}

export async function setupStudent(name: string, phone: string, code: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요해요" };

  const { error: pErr } = await supabase
    .from("profiles")
    .insert({ id: user.id, role: "student", name, phone: phone || null });
  if (pErr) return { error: pErr.message };

  const { error: jErr } = await supabase.rpc("join_teacher", { p_code: code });
  if (jErr) return { error: jErr.message };

  return { error: null };
}
