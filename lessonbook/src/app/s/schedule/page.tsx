import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import DaySchedule from "@/components/DaySchedule";
import type { ScheduleRow } from "@/lib/types";

function monthRange(offset: number) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(1);
  start.setMonth(start.getMonth() + offset);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return { start, end };
}

export default async function StudentSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { m } = await searchParams;
  const offset = Number(m ?? 0) || 0;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select(
      "id, teacher_id, status, teacher:profiles!enrollments_teacher_id_fkey(name)"
    )
    .eq("student_id", user!.id)
    .in("status", ["active", "pending", "rejected"]);

  const enrollment =
    enrollments?.find((e) => e.status === "active") ??
    enrollments?.find((e) => e.status === "pending") ??
    enrollments?.[0] ??
    null;

  if (!enrollment || enrollment.status !== "active") {
    const t = enrollment?.teacher as unknown as { name: string } | null;
    return (
      <div className="rounded-xl border border-line bg-card p-6 text-center">
        {enrollment?.status === "pending" ? (
          <>
            <p className="font-semibold">선생님 승인을 기다리는 중이에요</p>
            <p className="mt-1 text-sm text-ink-soft">
              {t?.name} 선생님이 승인하면 시간표가 열려요
            </p>
          </>
        ) : enrollment?.status === "rejected" ? (
          <>
            <p className="font-semibold">연결 신청이 거절됐어요</p>
            <p className="mt-1 text-sm text-ink-soft">
              코드를 다시 확인하거나 선생님께 문의해 주세요
            </p>
            <Link
              href="/onboarding"
              className="mt-4 inline-block text-sm text-pen"
            >
              가입 코드 다시 입력하기 →
            </Link>
          </>
        ) : (
          <>
            <p className="font-semibold">아직 연결된 선생님이 없어요</p>
            <p className="mt-1 text-sm text-ink-soft">
              선생님께 가입 코드를 받아 연결해 주세요
            </p>
            <Link
              href="/onboarding"
              className="mt-4 inline-block text-sm text-pen"
            >
              가입 코드 입력하기 →
            </Link>
          </>
        )}
      </div>
    );
  }

  const { start, end } = monthRange(offset);
  const { data: rows } = await supabase.rpc("get_week_schedule", {
    p_teacher: enrollment.teacher_id,
    p_from: start.toISOString(),
    p_to: end.toISOString(),
  });

  // 학생도 선생님의 예약 정책은 읽을 수 있다 (RLS: settings student read)
  const { data: settings } = await supabase
    .from("teacher_settings")
    .select(
      "lesson_minutes, allow_student_cancel, allow_student_swap, swap_needs_approval, cancel_free_hours, book_free_hours, swap_free_hours, allow_trial, trial_limit, trial_price"
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
        monthOffset={offset}
        lessonMinutes={settings?.lesson_minutes ?? 60}
        policy={{
          allow_student_cancel: settings?.allow_student_cancel ?? true,
          allow_student_swap: settings?.allow_student_swap ?? true,
          swap_needs_approval: settings?.swap_needs_approval ?? false,
          cancel_free_hours: settings?.cancel_free_hours ?? 12,
          book_free_hours: settings?.book_free_hours ?? 12,
          swap_free_hours: settings?.swap_free_hours ?? 12,
          allow_trial: settings?.allow_trial ?? true,
          trial_limit: settings?.trial_limit ?? 1,
          trial_price: settings?.trial_price ?? 0,
        }}
        classes={classes}
      />
    </div>
  );
}
