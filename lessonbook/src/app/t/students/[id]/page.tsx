import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import JournalForm from "@/components/JournalForm";
import { MemoForm } from "@/components/TeacherStudentForms";
import type {
  JournalEntry,
  SettlementRow,
  StudentOverview,
} from "@/lib/types";
import { fmtDate, fmtDateTime, fmtKRW } from "@/lib/utils";

type PaymentRow = {
  id: string;
  amount: number;
  covers_sessions: number;
  note: string | null;
  paid_at: string;
};

function fmtD(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: overview }, { data: settlement }] = await Promise.all([
    supabase.rpc("get_students_overview"),
    supabase.rpc("get_settlement"),
  ]);

  const s = ((overview as StudentOverview[]) ?? []).find(
    (x) => x.enrollment_id === id
  );
  if (!s) notFound();

  const billing = ((settlement as SettlementRow[]) ?? []).filter(
    (r) => r.enrollment_id === id
  );

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
        <div className="mt-2">
          <h1 className="text-xl font-bold">{s.student_name}</h1>
          <p className="mt-0.5 text-sm text-ink-soft">
            {s.phone ?? "연락처 없음"} · {fmtDate(s.started_at)} 시작 · 수업{" "}
            {s.completed}회 완료
          </p>
        </div>
      </div>

      {/* 반별 정산 현황 */}
      <section className="rounded-2xl border border-line bg-card p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">반 · 정산</p>
          <Link href="/t/settlement" className="text-xs text-pen">
            정산 탭에서 처리 →
          </Link>
        </div>
        {billing.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">
            아직 반에 소속되지 않았어요.{" "}
            <Link href="/t/classes" className="text-pen underline">
              반 탭
            </Link>
            에서 넣을 수 있어요.
          </p>
        ) : (
          <ul className="ruled mt-2">
            {billing.map((r) => (
              <li key={r.class_id} className="py-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{r.class_name}</p>
                  <span className="num text-xs text-ink-soft">
                    회차당 {fmtKRW(r.price)}
                  </span>
                </div>
                {r.billing_method === "monthly" ? (
                  <p className="num mt-1 text-sm text-ink-soft">
                    이번 정산({fmtD(r.window_start)}~{fmtD(r.window_end)}):{" "}
                    {r.window_count}회 = {fmtKRW(r.window_amount)}{" "}
                    {r.window_count > 0 &&
                      (r.window_paid ? (
                        <span className="font-semibold text-ok">입금됨</span>
                      ) : (
                        <span className="font-semibold text-redpen">
                          미입금
                        </span>
                      ))}
                  </p>
                ) : (
                  <p
                    className={`num mt-1 text-sm ${
                      r.prepay_remaining <= 0
                        ? "font-semibold text-redpen"
                        : "text-ink-soft"
                    }`}
                  >
                    선불 잔여 {r.prepay_remaining}회 (충전 {r.prepaid_total}회 ·
                    완료 {r.completed_total}회)
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 입금 내역 */}
      <section className="rounded-2xl border border-line bg-card p-4">
        <p className="text-sm font-semibold">입금 내역</p>
        {(payments as PaymentRow[])?.length ? (
          <ul className="ruled mt-2">
            {(payments as PaymentRow[]).map((p) => (
              <li key={p.id} className="flex justify-between py-2 text-sm">
                <span className="text-ink-soft">
                  {fmtDate(p.paid_at)}
                  {p.note ? ` · ${p.note}` : ""}
                </span>
                <span className="num">{fmtKRW(p.amount)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-ink-soft">아직 입금 내역이 없어요</p>
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
