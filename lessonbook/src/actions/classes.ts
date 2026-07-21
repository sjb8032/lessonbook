"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { BillingMethod } from "@/lib/types";

function refresh() {
  revalidatePath("/t/classes");
  revalidatePath("/t/schedule");
  revalidatePath("/t/settlement");
}

type ClassForm = {
  name: string;
  description: string;
  price: number; // 회차당 단가(원)
};

export async function createClass(form: ClassForm) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요해요" };
  if (!form.name.trim()) return { error: "반 이름을 입력해 주세요" };
  if (form.price < 0) return { error: "단가는 0 이상이어야 해요" };

  const { error } = await supabase.from("classes").insert({
    teacher_id: user.id,
    name: form.name.trim(),
    description: form.description.trim() || null,
    price: form.price,
  });
  refresh();
  return { error: error?.message ?? null };
}

export async function updateClass(classId: string, form: ClassForm) {
  const supabase = await createClient();
  if (!form.name.trim()) return { error: "반 이름을 입력해 주세요" };
  if (form.price < 0) return { error: "단가는 0 이상이어야 해요" };

  const { error } = await supabase
    .from("classes")
    .update({
      name: form.name.trim(),
      description: form.description.trim() || null,
      price: form.price,
    })
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

/** 학생(enrollment)을 반에 넣거나 뺀다. 넣을 땐 기본 월 정산 */
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

/** 학생의 결제 방식 설정 (월 정산 / 선불 N회) */
export async function setMemberBilling(
  classId: string,
  enrollmentId: string,
  method: BillingMethod,
  prepaySessions: number | null
) {
  const supabase = await createClient();
  if (method === "prepay" && (!prepaySessions || prepaySessions < 1)) {
    return { error: "선불 회차 수를 1 이상으로 입력해 주세요" };
  }
  const { error } = await supabase
    .from("class_members")
    .update({
      billing_method: method,
      prepay_sessions: method === "prepay" ? prepaySessions : null,
    })
    .eq("class_id", classId)
    .eq("enrollment_id", enrollmentId);
  refresh();
  return { error: error?.message ?? null };
}
