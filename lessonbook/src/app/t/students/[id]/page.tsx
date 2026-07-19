import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import JournalForm from "@/components/JournalForm";
import { PaymentForm, MemoForm } from "@/components/TeacherStudentForms";
import type { JournalEntry, Payment, StudentOverview } from "@/lib/types";
import { fmtDate, fmtDateTime, fmtKRW } from "@/lib/utils";

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: overview } = await supabase.rpc("get_students_overview");
  const s = ((overview as StudentOverview[]) ?? []).find(
    (x) => x.enrollment_id === id
  );
  if (!s) notFound();

  const [{ data: journal }, { data: payments }, { data: upcoming }] =
    await Promise.all([
      supabase
        .from("journal_entries")
        .select("id, lesson_date, progress, notes, homework, created_at")
        .eq("enrollment_id", id)
        .order("lesson_date", { ascending: false })
        .limit(30),
      supabase
        .from("payments")
        .select("id, amount, covers_sessions, note, paid_at")
        .eq("enrollment_id", id)
        .order("paid_at", { ascending: false })
        .limit(10),
      supabase
        .from("bookings")
        .select("id, slot:slots(starts_at)")
        .eq("enrollment_id", id)
        .eq("status", "confirmed")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

  const upcomingSorted = ((upcoming as unknown as { id: string; slot: { starts_at: string } | null }[]) ?? [])
    .filter((b) => b.slot && new Date(b.slot.starts_at) > new Date())
    .sort((a, b) => a.slot!.starts_at.localeCompare(b.slot!.starts_at));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/t/students" className="text-sm text-ink-soft">
          ← 학생 목록
        </Link>
        <div className="mt-2 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold">{s.student_name}</h1>
            <p className="mt-0.5 text-sm text-ink-soft">
              {s.phone ?? "연락처 없음"} · {fmtDate(s.started_at)} 시작
            </p>
          </div>
        </div>
      </div>

      {/* 회차 · 결제 현황 */}
      <section className="rounded-2xl border border-line bg-card p-4">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-ink-soft">완료 회차</p>
            <p className="num text-2xl font-bold">{s.completed}회</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-ink-soft">결제된 회차</p>
            <p className="num text-2xl font-bold">{s.paid}회</p>
          </div>
          <span
            className={`num rounded-full px-3 py-1 text-xs font-semibold ${
              s.balance <= 0 ? "bg-redpen-soft text-redpen" : "bg-ok-soft text-ok"
            }`}
          >
            {s.balance <= 0 ? "결제 필요" : `${s.balance}회 남음`}
          </span>
        </div>
        <p className="num mt-2 text-xs text-ink-soft">
          {s.cycle_length}회마다 {fmtKRW(s.cycle_price)}
        </p>
        <div className="mt-4 border-t border-line pt-4">
          <p className="mb-2 text-sm font-semibold">입금 확인</p>
          <PaymentForm
            enrollmentId={id}
            defaultAmount={s.cycle_price}
            defaultCovers={s.cycle_length}
          />
        </div>
        {(payments as Payment[])?.length > 0 && (
          <ul className="ruled mt-4">
            {(payments as Payment[]).map((p) => (
              <li key={p.id} className="flex justify-between py-2 text-sm">
                <span className="text-ink-soft">
                  {fmtDate(p.paid_at)}
                  {p.note ? ` · ${p.note}` : ""}
                </span>
                <span className="num">
                  {fmtKRW(p.amount)} ({p.covers_sessions}회)
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 다가오는 수업 */}
      {upcomingSorted.length > 0 && (
        <section className="rounded-2xl border border-line bg-card p-4">
          <p className="text-sm font-semibold">다가오는 수업</p>
          <ul className="ruled mt-2">
            {upcomingSorted.map((b) => (
              <li key={b.id} className="num py-2 text-sm">
                {fmtDateTime(b.slot!.starts_at)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 일지 */}
      <section className="rounded-2xl border border-line bg-card p-4">
        <p className="text-sm font-semibold">레슨 일지</p>
        <div className="mt-2">
          <JournalForm enrollmentId={id} />
        </div>
        {(journal as JournalEntry[])?.length > 0 && (
          <ul className="ruled mt-4">
            {(journal as JournalEntry[]).map((j) => (
              <li key={j.id} className="py-3">
                <p className="num text-xs font-semibold text-ink-soft">
                  {fmtDate(j.lesson_date)}
                </p>
                {j.progress && (
                  <p className="mt-1 text-sm">
                    <span className="font-medium text-pen">진도</span> {j.progress}
                  </p>
                )}
                {j.notes && (
                  <p className="mt-0.5 text-sm">
                    <span className="font-medium text-ink-soft">비고</span> {j.notes}
                  </p>
                )}
                {j.homework && (
                  <p className="mt-0.5 text-sm">
                    <span className="font-medium text-redpen">과제</span> {j.homework}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 선생님 메모 */}
      <section className="rounded-2xl border border-line bg-card p-4">
        <p className="text-sm font-semibold">
          메모 <span className="font-normal text-ink-soft">(학생에게 비공개)</span>
        </p>
        <div className="mt-2">
          <MemoForm enrollmentId={id} initial={s.teacher_memo ?? ""} />
        </div>
      </section>
    </div>
  );
}
