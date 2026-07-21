import { createClient } from "@/lib/supabase/server";
import type { JournalEntry, MyBillingRow } from "@/lib/types";
import { fmtDate, fmtKRW } from "@/lib/utils";

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

  const [{ data: billingData }, { data: settings }, { data: payments }, { data: journal }] =
    await Promise.all([
      supabase.rpc("get_my_billing"),
      supabase
        .from("teacher_settings")
        .select("bank_info, payment_link, billing_day")
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

  const billing = (billingData as MyBillingRow[]) ?? [];
  const teacher = enrollment.teacher as unknown as { name: string } | null;

  // 지금 내야 할 게 있는지: 미입금 월 정산 or 소진된 선불
  const dueMonthly = billing.filter(
    (r) => r.billing_method === "monthly" && r.window_count > 0 && !r.window_paid
  );
  const depletedPrepay = billing.filter(
    (r) => r.billing_method === "prepay" && r.prepay_remaining <= 0
  );
  const dueTotal = dueMonthly.reduce((sum, r) => sum + r.window_amount, 0);
  const hasDue = dueMonthly.length > 0 || depletedPrepay.length > 0;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">{teacher?.name} 선생님 수강</h1>

      {/* 반별 현황 */}
      {billing.length === 0 ? (
        <p className="rounded-2xl border border-line bg-card p-4 text-sm text-ink-soft">
          아직 반에 배정되지 않았어요. 선생님이 반에 넣어주시면 여기서 회차와
          정산을 볼 수 있어요.
        </p>
      ) : (
        <section className="space-y-3">
          {billing.map((r) => (
            <div
              key={r.class_id}
              className="rounded-2xl border border-line bg-card p-4"
            >
              <div className="flex items-center justify-between">
                <p className="font-semibold">{r.class_name}</p>
                <span className="num text-xs text-ink-soft">
                  회차당 {fmtKRW(r.price)}
                </span>
              </div>

              {r.billing_method === "monthly" ? (
                <>
                  <p className="num mt-2 text-sm">
                    이번 정산({fmtD(r.window_start)}~{fmtD(r.window_end)}):{" "}
                    <b>{r.window_count}회</b> = <b>{fmtKRW(r.window_amount)}</b>
                  </p>
                  {r.window_count > 0 && (
                    <p
                      className={`mt-1 text-xs font-semibold ${
                        r.window_paid ? "text-ok" : "text-redpen"
                      }`}
                    >
                      {r.window_paid ? "✓ 입금 확인됨" : "입금 대기"}
                    </p>
                  )}
                  <p className="num mt-1 text-xs text-ink-soft">
                    지금까지 총 {r.completed_total}회 수강
                  </p>
                </>
              ) : (
                <>
                  <p
                    className={`num mt-2 text-sm ${
                      r.prepay_remaining <= 0
                        ? "font-semibold text-redpen"
                        : ""
                    }`}
                  >
                    선불 잔여 <b>{r.prepay_remaining}회</b>
                    {r.prepay_remaining <= 0 && " — 충전이 필요해요"}
                  </p>
                  <p className="num mt-1 text-xs text-ink-soft">
                    충전 {r.prepaid_total}회 · 완료 {r.completed_total}회
                  </p>
                </>
              )}
            </div>
          ))}
        </section>
      )}

      {/* 결제 안내 */}
      {hasDue && (
        <section className="rounded-2xl border border-redpen bg-redpen-soft p-4">
          <p className="text-sm font-semibold text-redpen">
            {dueTotal > 0
              ? `이번 정산 ${fmtKRW(dueTotal)} 입금이 필요해요`
              : "선불 충전이 필요해요"}
          </p>
          {settings?.bank_info && (
            <p className="num mt-1 text-sm">{settings.bank_info}</p>
          )}
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
        </section>
      )}

      {/* 결제 내역 */}
      <section className="rounded-2xl border border-line bg-card p-4">
        <p className="text-sm font-semibold">결제 내역</p>
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
