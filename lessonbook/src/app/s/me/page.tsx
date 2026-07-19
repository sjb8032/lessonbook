import { createClient } from "@/lib/supabase/server";
import type { JournalEntry, Payment } from "@/lib/types";
import { fmtDate, fmtKRW } from "@/lib/utils";

type Summary = {
  completed: number;
  paid: number;
  balance: number;
  cycle_length: number;
  cycle_price: number;
};

export default async function MyPage() {
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
      <p className="text-sm text-ink-soft">아직 연결된 선생님이 없어요.</p>
    );
  }

  const [{ data: summaryData }, { data: settings }, { data: payments }, { data: journal }] =
    await Promise.all([
      supabase.rpc("get_my_summary", { p_enrollment: enrollment.id }),
      supabase
        .from("teacher_settings")
        .select("bank_info, payment_link")
        .eq("teacher_id", enrollment.teacher_id)
        .maybeSingle(),
      supabase
        .from("payments")
        .select("id, amount, covers_sessions, note, paid_at")
        .eq("enrollment_id", enrollment.id)
        .order("paid_at", { ascending: false })
        .limit(10),
      supabase
        .from("journal_entries")
        .select("id, lesson_date, progress, notes, homework, created_at")
        .eq("enrollment_id", enrollment.id)
        .order("lesson_date", { ascending: false })
        .limit(30),
    ]);

  const summary = (summaryData as Summary[] | null)?.[0];
  const teacher = enrollment.teacher as unknown as { name: string } | null;
  const due = (summary?.balance ?? 0) <= 0;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">{teacher?.name} 선생님 수강</h1>

      {/* 회차 현황 */}
      <section
        className={`rounded-2xl border p-4 ${
          due ? "border-redpen bg-redpen-soft" : "border-line bg-card"
        }`}
      >
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-ink-soft">완료한 수업</p>
            <p className="num text-3xl font-bold">{summary?.completed ?? 0}회</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-ink-soft">결제분</p>
            <p className="num text-3xl font-bold">{summary?.paid ?? 0}회</p>
          </div>
        </div>
        {due ? (
          <div className="mt-3 border-t border-redpen/30 pt-3">
            <p className="text-sm font-semibold text-redpen">
              이번 사이클이 끝났어요 — 다음 {summary?.cycle_length}회분 결제가
              필요해요
            </p>
            <p className="num mt-1 text-sm">
              {fmtKRW(summary?.cycle_price ?? 0)}
              {settings?.bank_info ? ` · ${settings.bank_info}` : ""}
            </p>
            {settings?.payment_link && (
              <a
                href={settings.payment_link}
                target="_blank"
                rel="noreferrer"
                className="mt-3 block w-full rounded-xl bg-redpen py-3 text-center font-semibold text-white"
              >
                송금 링크 열기
              </a>
            )}
            <p className="mt-2 text-xs text-ink-soft">
              입금 후 선생님이 확인하면 자동으로 반영돼요
            </p>
          </div>
        ) : (
          <p className="num mt-2 text-sm text-ok">
            결제분 {summary?.balance}회 남았어요
          </p>
        )}
      </section>

      {/* 결제 내역 */}
      <section className="rounded-2xl border border-line bg-card p-4">
        <p className="text-sm font-semibold">결제 내역</p>
        {(payments as Payment[])?.length ? (
          <ul className="ruled mt-2">
            {(payments as Payment[]).map((p) => (
              <li key={p.id} className="flex justify-between py-2 text-sm">
                <span className="text-ink-soft">{fmtDate(p.paid_at)}</span>
                <span className="num">
                  {fmtKRW(p.amount)} ({p.covers_sessions}회분)
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-ink-soft">아직 결제 내역이 없어요</p>
        )}
      </section>

      {/* 레슨 일지 */}
      <section className="rounded-2xl border border-line bg-card p-4">
        <p className="text-sm font-semibold">레슨 일지</p>
        {(journal as JournalEntry[])?.length ? (
          <ul className="ruled mt-2">
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
        ) : (
          <p className="mt-2 text-sm text-ink-soft">
            선생님이 일지를 쓰면 여기에 쌓여요
          </p>
        )}
      </section>
    </div>
  );
}
