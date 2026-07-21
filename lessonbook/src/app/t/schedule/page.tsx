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

export default async function TeacherSchedulePage({
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

  const { start, end } = weekRange(offset);
  const { data: rows } = await supabase.rpc("get_week_schedule", {
    p_teacher: user!.id,
    p_from: start.toISOString(),
    p_to: end.toISOString(),
  });
  const { data: settings } = await supabase
    .from("teacher_settings")
    .select(
      "lesson_minutes, join_code, allow_student_cancel, allow_student_swap, swap_needs_approval, cancel_free_hours, book_free_hours, swap_free_hours"
    )
    .eq("teacher_id", user!.id)
    .single();

  const { data: classRows } = await supabase.rpc("get_classes");
  const classes = ((classRows as { id: string; name: string; archived: boolean }[]) ?? [])
    .filter((c) => !c.archived)
    .map((c) => ({ id: c.id, name: c.name }));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between rounded-xl bg-pen-soft px-4 py-2.5">
        <span className="text-sm text-pen">수강생 가입 코드</span>
        <span className="num text-sm font-bold tracking-widest text-pen">
          {settings?.join_code}
        </span>
      </div>
      <DaySchedule
        role="teacher"
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
      <p className="mt-3 text-xs text-ink-soft">
        빈 시간을 탭해 열어두면, 수강생이 직접 보고 예약해요. 물어볼 필요가
        없어져요.
      </p>
    </div>
  );
}
