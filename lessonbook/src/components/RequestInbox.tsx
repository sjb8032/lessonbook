"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TeacherRequest } from "@/lib/types";
import { fmtDateTime } from "@/lib/utils";
import { respondBooking, respondCancel } from "@/actions/bookings";
import { respondSwapTeacher } from "@/actions/swaps";

const HEADING: Record<TeacherRequest["kind"], string> = {
  booking: "예약 신청",
  cancel: "취소 요청",
  swap: "시간 교환 승인",
};

const ACCEPT_LABEL: Record<TeacherRequest["kind"], string> = {
  booking: "예약 승인",
  cancel: "취소 승인",
  swap: "교환 승인",
};

const REJECT_LABEL: Record<TeacherRequest["kind"], string> = {
  booking: "반려",
  cancel: "반려 (수업 유지)",
  swap: "반려 (시간 유지)",
};

export default function RequestInbox({
  requests,
}: {
  requests: TeacherRequest[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function respond(req: TeacherRequest, accept: boolean) {
    setError(null);
    setBusy(req.kind + req.ref_id);
    startTransition(async () => {
      const res =
        req.kind === "booking"
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

            <p className="num mt-2 text-sm">
              {fmtDateTime(req.starts_at)}
              {req.other_time && (
                <> ↔ {fmtDateTime(req.other_time)}</>
              )}
            </p>

            {req.message && (
              <p className="mt-2 text-sm text-ink-soft">&ldquo;{req.message}&rdquo;</p>
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
