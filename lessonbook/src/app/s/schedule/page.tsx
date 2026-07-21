import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import DaySchedule from "@/components/DaySchedule";
import type { ScheduleRow } from "@/lib/types";

function weekRange(offset: number) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const start = new Date(now);
  start.setDate(start.getDate() + diff + offset * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

export default async function StudentSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ w?: string }>;
}) {
  const { w } = await searchParams;
  const offset = Number(w ?? 0) || 0;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("id, teacher_id, teacher:profiles!enrollments_teacher_id_fkey(name)")
    .eq("student_id", user!.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (!enrollment) {
    return (
      <div className="rounded-xl border border-line bg-card p-6 text-center">
        <p className="font-semibold">아직 연결된 선생님이 없어요</p>
        <p className="mt-1 text-sm text-ink-soft">
          선생님께 가입 코드를 받아 연결해 주세요
        </p>
        <Link href="/onboarding" className="mt-4 inline-block text-sm text-pen">
          가입 코드 입력하기 →
        </Link>
      </div>
    );
  }

  const { start, end } = weekRange(offset);
  const { data: rows } = await supabase.rpc("get_week_schedule", {
    p_teacher: enrollment.teacher_id,
    p_from: start.toISOString(),
    p_to: end.toISOString(),
  });

  // 학생도 선생님의 예약 정책은 읽을 수 있다 (RLS: settings student read)
  const { data: settings } = await supabase
    .from("teacher_settings")
    .select(
      "lesson_minutes, allow_student_cancel, allow_student_swap, swap_needs_approval, cancel_free_hours, book_free_hours, swap_free_hours"
    )
    .eq("teacher_id", enrollment.teacher_id)
    .maybeSingle();

  // 내가 속한 반 (제한 없는 수업 예약 시 반 선택용)
  const { data: myClassRows } = await supabase.rpc("get_my_classes", {
    p_teacher: enrollment.teacher_id,
  });
  const classes = ((myClassRows as { class_id: string; name: string }[]) ?? []).map(
    (c) => ({ id: c.class_id, name: c.name })
  );

  const teacher = enrollment.teacher as unknown as { name: string } | null;

  return (
    <div>
      <p className="mb-3 text-sm text-ink-soft">
        {teacher?.name} 선생님의 시간표 · 빈 시간은 눈치 볼 필요 없이 바로
        예약하세요
      </p>
      <DaySchedule
        role="student"
        rows={(rows as ScheduleRow[]) ?? []}
        weekOffset={offset}
        lessonMinutes={settings?.lesson_minutes ?? 60}
        policy={{
          allow_student_cancel: settings?.allow_student_cancel ?? true,
          allow_student_swap: settings?.allow_student_swap ?? true,
          swap_needs_approval: settings?.swap_needs_approval ?? false,
          cancel_free_hours: settings?.cancel_free_hours ?? 12,
          book_free_hours: settings?.book_free_hours ?? 12,
          swap_free_hours: settings?.swap_free_hours ?? 12,
        }}
        classes={classes}
      />
    </div>
  );
}
