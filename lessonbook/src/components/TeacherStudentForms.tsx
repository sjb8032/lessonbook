"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordPayment } from "@/actions/bookings";
import { saveTeacherMemo } from "@/actions/journal";
import { fmtKRW } from "@/lib/utils";

export function PaymentForm({
  enrollmentId,
  defaultAmount,
  defaultCovers,
}: {
  enrollmentId: string;
  defaultAmount: number;
  defaultCovers: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState(defaultAmount);
  const [covers, setCovers] = useState(defaultCovers);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await recordPayment(enrollmentId, amount, covers, note);
      if (res.error) setError(res.error);
      else {
        setNote("");
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-xs text-ink-soft">금액</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="num w-full rounded-lg border border-line bg-card px-3 py-2.5 text-sm"
          />
        </div>
        <div className="w-24">
          <label className="text-xs text-ink-soft">회차 수</label>
          <input
            type="number"
            value={covers}
            onChange={(e) => setCovers(Number(e.target.value))}
            className="num w-full rounded-lg border border-line bg-card px-3 py-2.5 text-sm"
          />
        </div>
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="메모 (선택)"
        className="w-full rounded-lg border border-line bg-card px-3 py-2.5 text-sm"
      />
      {error && <p className="text-sm text-redpen">{error}</p>}
      <button
        disabled={pending || amount <= 0 || covers <= 0}
        className="w-full rounded-xl bg-ok py-2.5 text-sm font-semibold text-white disabled:opacity-40"
      >
        {pending ? "처리 중…" : `${fmtKRW(amount)} · ${covers}회분 입금 확인`}
      </button>
    </form>
  );
}

export function MemoForm({
  enrollmentId,
  initial,
}: {
  enrollmentId: string;
  initial: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [memo, setMemo] = useState(initial);
  const [saved, setSaved] = useState(false);

  return (
    <div className="space-y-2">
      <textarea
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        rows={3}
        placeholder="이 학생에 대한 메모 (학생에게 보이지 않아요)"
        className="w-full rounded-lg border border-line bg-card px-3 py-2.5 text-sm"
      />
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await saveTeacherMemo(enrollmentId, memo);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
            router.refresh();
          })
        }
        className="rounded-lg border border-line px-4 py-2 text-sm text-ink-soft hover:border-pen hover:text-pen disabled:opacity-40"
      >
        {saved ? "저장됐어요 ✓" : "메모 저장"}
      </button>
    </div>
  );
}
