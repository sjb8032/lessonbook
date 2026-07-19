"use client";

import { useState, useTransition } from "react";
import { saveSettings } from "@/actions/journal";
import type { TeacherSettings } from "@/lib/types";

export default function SettingsForm({ initial }: { initial: TeacherSettings }) {
  const [pending, startTransition] = useTransition();
  const [cycleLength, setCycleLength] = useState(initial.cycle_length);
  const [cyclePrice, setCyclePrice] = useState(initial.cycle_price);
  const [bankInfo, setBankInfo] = useState(initial.bank_info ?? "");
  const [paymentLink, setPaymentLink] = useState(initial.payment_link ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await saveSettings({
        cycle_length: cycleLength,
        cycle_price: cyclePrice,
        bank_info: bankInfo,
        payment_link: paymentLink,
      });
      if (res.error) setError(res.error);
      else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-sm font-medium">결제 주기 (회차)</label>
          <input
            type="number"
            min={1}
            value={cycleLength}
            onChange={(e) => setCycleLength(Number(e.target.value))}
            className="num mt-1 w-full rounded-xl border border-line bg-card px-4 py-3"
          />
          <p className="mt-1 text-xs text-ink-soft">몇 회차마다 결제인지</p>
        </div>
        <div className="flex-1">
          <label className="text-sm font-medium">사이클당 수강료 (원)</label>
          <input
            type="number"
            min={0}
            step={1000}
            value={cyclePrice}
            onChange={(e) => setCyclePrice(Number(e.target.value))}
            className="num mt-1 w-full rounded-xl border border-line bg-card px-4 py-3"
          />
        </div>
      </div>
      <div>
        <label className="text-sm font-medium">계좌 안내</label>
        <input
          value={bankInfo}
          onChange={(e) => setBankInfo(e.target.value)}
          placeholder="예: 카카오뱅크 3333-00-000000 홍길동"
          className="mt-1 w-full rounded-xl border border-line bg-card px-4 py-3"
        />
      </div>
      <div>
        <label className="text-sm font-medium">송금 링크 (선택)</label>
        <input
          value={paymentLink}
          onChange={(e) => setPaymentLink(e.target.value)}
          placeholder="토스 송금 링크 등"
          className="mt-1 w-full rounded-xl border border-line bg-card px-4 py-3"
        />
        <p className="mt-1 text-xs text-ink-soft">
          결제 회차가 되면 학생에게 이 링크가 보여요
        </p>
      </div>
      {error && <p className="text-sm text-redpen">{error}</p>}
      <button
        disabled={pending}
        className="w-full rounded-xl bg-pen py-3 font-semibold text-white disabled:opacity-50"
      >
        {saved ? "저장됐어요 ✓" : pending ? "저장 중…" : "설정 저장"}
      </button>
    </form>
  );
}
