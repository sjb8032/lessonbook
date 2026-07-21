"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function refresh() {
  revalidatePath("/t/classes");
  revalidatePath("/t/schedule");
}

export async function createClass(name: string, description: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요해요" };
  if (!name.trim()) return { error: "반 이름을 입력해 주세요" };

  const { error } = await supabase.from("classes").insert({
    teacher_id: user.id,
    name: name.trim(),
    description: description.trim() || null,
  });
  refresh();
  return { error: error?.message ?? null };
}

export async function updateClass(
  classId: string,
  name: string,
  description: string
) {
  const supabase = await createClient();
  if (!name.trim()) return { error: "반 이름을 입력해 주세요" };
  const { error } = await supabase
    .from("classes")
    .update({ name: name.trim(), description: description.trim() || null })
    .eq("id", classId);
  refresh();
  return { error: error?.message ?? null };
}

export async function setClassArchived(classId: string, archived: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("classes")
    .update({ archived })
    .eq("id", classId);
  refresh();
  return { error: error?.message ?? null };
}

/** 학생(enrollment)을 반에 넣거나 뺀다 */
export async function setClassMember(
  classId: string,
  enrollmentId: string,
  member: boolean
) {
  const supabase = await createClient();
  const { error } = member
    ? await supabase
        .from("class_members")
        .upsert(
          { class_id: classId, enrollment_id: enrollmentId },
          { onConflict: "class_id,enrollment_id" }
        )
    : await supabase
        .from("class_members")
        .delete()
        .eq("class_id", classId)
        .eq("enrollment_id", enrollmentId);
  refresh();
  return { error: error?.message ?? null };
}
