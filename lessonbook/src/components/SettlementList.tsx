"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SettlementRow } from "@/lib/types";
import { fmtKRW } from "@/lib/utils";
import {
  confirmSettlement,
  cancelSettlement,
  addPrepay,
} from "@/actions/settlement";

function fmtD(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function SettlementList({ rows }: { rows: SettlementRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function run(key: string, fn: () => Promise<{ error: string | null }>) {
    setError(null);
    setBusy(key);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  const monthly = rows.filter((r) => r.billing_method === "monthly");
  const prepay = rows.filter((r) => r.billing_method === "prepay");

  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-line bg-card p-6 text-center text-sm text-ink-soft">
        아직 반에 소속된 학생이 없어요. 반 탭에서 학생을 반에 넣으면 여기서
        정산할 수 있어요.
      </p>
    );
  }

  const window = rows[0];
  const unpaidTotal = monthly
    .filter((r) => !r.window_paid)
    .reduce((sum, r) => sum + r.window_amount, 0);

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-redpen">{error}</p>}

      {/* 이번 정산 요약 */}
      <div className="rounded-2xl border border-line bg-card p-4">
        <p className="text-xs text-ink-soft">이번 정산 기간</p>
        <p className="num mt-0.5 font-semibold">
          {fmtD(window.window_start)} ~ {fmtD(window.window_end)}
        </p>
        {monthly.length > 0 && (
          <p className="num mt-2 text-sm">
            받을 돈{" "}
            <span
              className={`font-bold ${
                unpaidTotal > 0 ? "text-redpen" : "text-ok"
              }`}
            >
              {fmtKRW(unpaidTotal)}
            </span>
          </p>
        )}
      </div>

      {/* 월 정산 */}
      {monthly.length > 0 && (
        <section>
          <p className="text-sm font-semibold">월 정산</p>
          <div className="mt-2 space-y-2">
            {monthly.map((r) => {
              const key = `${r.class_id}:${r.enrollment_id}`;
              return (
                <div
                  key={key}
                  className="rounded-2xl border border-line bg-card p-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold">
                        {r.student_name}
                        <span className="ml-1.5 text-xs font-normal text-ink-soft">
                          {r.class_name}
                        </span>
                      </p>
                      <p className="num mt-0.5 text-sm text-ink-soft">
                        {r.window_count === 0
                          ? "이번 기간 완료한 수업이 없어요"
                          : `${r.window_count}회 × ${fmtKRW(r.price)} = ${fmtKRW(
                              r.window_amount
                            )}`}
                      </p>
                    </div>

                    {r.window_count > 0 &&
                      (r.window_paid ? (
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-ok-soft px-2.5 py-1 text-xs font-semibold text-ok">
                            ✓ 입금됨
                          </span>
                          <button
                            disabled={pending && busy === key}
                            onClick={() =>
                              run(key, () =>
                                cancelSettlement(r.class_id, r.enrollment_id)
                              )
                            }
                            className="text-xs text-ink-soft hover:text-redpen"
                          >
                            취소
                          </button>
                        </div>
                      ) : (
                        <button
                          disabled={pending && busy === key}
                          onClick={() =>
                            run(key, () =>
                              confirmSettlement(r.class_id, r.enrollment_id)
                            )
                          }
                          className="shrink-0 rounded-xl bg-pen px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          입금 확인
                        </button>
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 선불 */}
      {prepay.length > 0 && (
        <section>
          <p className="text-sm font-semibold">선불</p>
          <div className="mt-2 space-y-2">
            {prepay.map((r) => {
              const key = `${r.class_id}:${r.enrollment_id}`;
              const n = r.prepay_sessions ?? 4;
              const low = r.prepay_remaining <= 0;
              return (
                <div
                  key={key}
                  className={`rounded-2xl border p-4 ${
                    low ? "border-redpen bg-redpen-soft" : "border-line bg-card"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold">
                        {r.student_name}
                        <span className="ml-1.5 text-xs font-normal text-ink-soft">
                          {r.class_name}
                        </span>
                      </p>
                      <p
                        className={`num mt-0.5 text-sm ${
                          low ? "font-semibold text-redpen" : "text-ink-soft"
                        }`}
                      >
                        {low
                          ? `선불이 다 됐어요 (${r.prepay_remaining}회)`
                          : `잔여 ${r.prepay_remaining}회`}
                        {" · 충전 "}
                        {r.prepaid_total}회 / 완료 {r.completed_total}회
                      </p>
                    </div>
                    <button
                      disabled={pending && busy === key}
                      onClick={() =>
                        run(key, () => addPrepay(r.class_id, r.enrollment_id, n))
                      }
                      className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                        low ? "bg-redpen" : "bg-pen"
                      }`}
                    >
                      {n}회 충전
                      <span className="num block text-[11px] font-normal opacity-80">
                        {fmtKRW(n * r.price)}
                      </span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
