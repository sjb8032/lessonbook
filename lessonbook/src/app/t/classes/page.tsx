import { createClient } from "@/lib/supabase/server";
import ClassManager from "@/components/ClassManager";
import ShareJoinCode from "@/components/ShareJoinCode";
import type { ClassRow } from "@/lib/types";

export default async function ClassesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: classes } = await supabase.rpc("get_classes");

  const { data: settings } = await supabase
    .from("teacher_settings")
    .select("join_code")
    .eq("teacher_id", user!.id)
    .maybeSingle();

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("id, student:profiles!enrollments_student_id_fkey(name)")
    .eq("teacher_id", user!.id)
    .eq("status", "active");

  const { data: memberships } = await supabase
    .from("class_members")
    .select("class_id, enrollment_id, billing_method, prepay_sessions");

  const students = (enrollments ?? []).map((e) => ({
    enrollment_id: e.id as string,
    name:
      (e.student as unknown as { name: string } | null)?.name ?? "이름 없음",
  }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">반 / 수준</h1>
        <p className="mt-1 text-sm text-ink-soft">
          학생을 반으로 묶어 관리해요. 한 학생이 여러 반에 들어갈 수 있고,
          시간표에서 특정 반만 예약할 수 있는 시간을 열 수 있어요.
        </p>
      </div>

      <ShareJoinCode code={settings?.join_code ?? ""} />
      <p className="-mt-2 text-xs text-ink-soft">
        학생이 이 코드로 가입·연결하면 아래에서 반에 넣을 수 있어요
      </p>
      <ClassManager
        classes={(classes as ClassRow[]) ?? []}
        students={students}
        memberships={
          (memberships as {
            class_id: string;
            enrollment_id: string;
            billing_method: "monthly" | "prepay";
            prepay_sessions: number | null;
          }[]) ?? []
        }
      />
    </div>
  );
}
