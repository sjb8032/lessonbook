"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ClassRow, TeacherRequest } from "@/lib/types";
import { fmtDateTime, fmtRate } from "@/lib/utils";
import { respondBooking, respondCancel } from "@/actions/bookings";
import { respondSwapTeacher } from "@/actions/swaps";
import { respondEnrollment } from "@/actions/enrollments";

const HEADING: Record<TeacherRequest["kind"], string> = {
  enrollment: "수강 연결 신청",
  booking: "예약 신청",
  cancel: "취소 요청",
  swap: "시간 교환 승인",
};

const ACCEPT_LABEL: Record<TeacherRequest["kind"], string> = {
  enrollment: "연결 승인",
  booking: "예약 승인",
  cancel: "취소 승인",
  swap: "교환 승인",
};

const REJECT_LABEL: Record<TeacherRequest["kind"], string> = {
  enrollment: "거절",
  booking: "반려",
  cancel: "반려 (수업 유지)",
  swap: "반려 (시간 유지)",
};

export default function RequestInbox({
  requests,
  classes = [],
}: {
  requests: TeacherRequest[];
  classes?: ClassRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // 수강 신청별로 승인 시 배정할 반 (여러 반 선택 가능)
  const [picked, setPicked] = useState<Map<string, Set<string>>>(new Map());

  function togglePick(enrollmentId: string, classId: string) {
    setPicked((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(enrollmentId));
      if (set.has(classId)) set.delete(classId);
      else set.add(classId);
      next.set(enrollmentId, set);
      return next;
    });
  }

  function respond(req: TeacherRequest, accept: boolean) {
    setError(null);
    setBusy(req.kind + req.ref_id);
    startTransition(async () => {
      const res =
        req.kind === "enrollment"
          ? await respondEnrollment(
              req.ref_id,
              accept,
              accept ? [...(picked.get(req.ref_id) ?? [])] : []
            )
          : req.kind === "booking"
          ? await respondBooking(req.ref_id, accept)
          : req.kind === "cancel"
          ? await respondCancel(req.ref_id, accept)
          : await respondSwapTeacher(req.ref_id, accept);
      setBusy(null);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  if (requests.length === 0) {
    return (
      <p className="rounded-2xl border border-line bg-card p-6 text-center text-sm text-ink-soft">
        승인을 기다리는 요청이 없어요
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-redpen">{error}</p>}
      {requests.map((req) => {
        const key = req.kind + req.ref_id;
        return (
          <div key={key} className="rounded-2xl border border-pen bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-pen-soft px-2 py-0.5 text-xs font-semibold text-pen">
                {HEADING[req.kind]}
              </span>
              <span className="text-sm font-medium">{req.who}</span>
            </div>

            {req.kind === "enrollment" ? (
              <>
                <p className="mt-2 text-sm text-ink-soft">
                  새 수강생 연결 요청
                  {req.message && <span className="num"> · {req.message}</span>}
                </p>
                {classes.length > 0 ? (
                  <div className="mt-3 space-y-1.5 rounded-xl bg-line/20 p-2">
                    <p className="px-1 text-xs font-medium text-ink-soft">
                      승인하면서 넣을 반 (여러 개 가능, 나중에 바꿀 수 있어요)
                    </p>
                    {classes.map((c) => (
                      <label
                        key={c.id}
                        className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1"
                      >
                        <input
                          type="checkbox"
                          checked={picked.get(req.ref_id)?.has(c.id) ?? false}
                          onChange={() => togglePick(req.ref_id, c.id)}
                          className="h-5 w-5 accent-[var(--color-pen)]"
                        />
                        <span className="text-sm">{c.name}</span>
                        <span className="num ml-auto text-xs text-ink-soft">
                          {fmtRate(c.price)} ·{" "}
                          {c.default_billing_method === "prepay"
                            ? `${c.default_prepay_sessions}회 선불`
                            : "달마다"}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-ink-soft">
                    아직 만든 반이 없어요. 승인 후 반 관리에서 배정할 수 있어요.
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="num mt-2 text-sm">
                  {fmtDateTime(req.starts_at)}
                  {req.other_time && <> ↔ {fmtDateTime(req.other_time)}</>}
                </p>
                {req.message && (
                  <p className="mt-2 text-sm text-ink-soft">
                    &ldquo;{req.message}&rdquo;
                  </p>
                )}
              </>
            )}

            <div className="mt-3 flex gap-2">
              <button
                disabled={pending && busy === key}
                onClick={() => respond(req, true)}
                className="flex-1 rounded-xl bg-pen py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                {ACCEPT_LABEL[req.kind]}
              </button>
              <button
                disabled={pending && busy === key}
                onClick={() => respond(req, false)}
                className="flex-1 rounded-xl border border-line py-2.5 text-sm text-ink-soft disabled:opacity-40"
              >
                {REJECT_LABEL[req.kind]}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
