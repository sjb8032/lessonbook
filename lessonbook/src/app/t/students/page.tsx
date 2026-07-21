import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { StudentOverview } from "@/lib/types";
import { fmtDate, fmtKRW } from "@/lib/utils";

export default async function StudentsPage() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_students_overview");
  const students = (data as StudentOverview[]) ?? [];

  return (
    <div>
      <h1 className="text-xl font-bold">학생 {students.length}명</h1>
      {students.length === 0 ? (
        <div className="mt-4 rounded-xl border border-line bg-card p-6 text-center text-sm text-ink-soft">
          아직 학생이 없어요. 스케줄 화면의 가입 코드를 학생에게 공유해 주세요.
        </div>
      ) : (
        <ul className="ruled mt-4 rounded-2xl border border-line bg-card px-4">
          {students.map((s) => (
            <li key={s.enrollment_id}>
              <Link
                href={`/t/students/${s.enrollment_id}`}
                className="flex items-center justify-between py-3.5"
              >
                <div>
                  <p className="font-semibold">
                    {s.student_name}
                    {s.class_names && (
                      <span className="ml-1.5 text-xs font-normal text-ink-soft">
                        {s.class_names}
                      </span>
                    )}
                  </p>
                  <p className="num mt-0.5 text-xs text-ink-soft">
                    {s.class_names
                      ? `수업 ${s.completed}회 완료`
                      : "반 미배정 (녹음만 가능)"}
                    {s.last_lesson ? ` · 최근 ${fmtDate(s.last_lesson)}` : ""}
                  </p>
                </div>
                {s.prepay_depleted ? (
                  <span className="num rounded-full bg-redpen-soft px-3 py-1 text-xs font-semibold text-redpen">
                    선불 소진
                  </span>
                ) : s.due_amount > 0 ? (
                  <span className="num rounded-full bg-pen-soft px-3 py-1 text-xs font-semibold text-pen">
                    정산 {fmtKRW(s.due_amount)}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
