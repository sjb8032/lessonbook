"use client";

import { useState, useTransition } from "react";
import { saveSettings } from "@/actions/journal";
import type { TeacherSettings } from "@/lib/types";

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-pen)]"
      />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-ink-soft">{hint}</span>
      </span>
    </label>
  );
}

export default function SettingsForm({ initial }: { initial: TeacherSettings }) {
  const [pending, startTransition] = useTransition();
  const [cycleLength, setCycleLength] = useState(initial.cycle_length);
  const [cyclePrice, setCyclePrice] = useState(initial.cycle_price);
  const [bankInfo, setBankInfo] = useState(initial.bank_info ?? "");
  const [paymentLink, setPaymentLink] = useState(initial.payment_link ?? "");
  const [allowCancel, setAllowCancel] = useState(initial.allow_student_cancel);
  const [allowSwap, setAllowSwap] = useState(initial.allow_student_swap);
  const [swapNeedsApproval, setSwapNeedsApproval] = useState(
    initial.swap_needs_approval
  );
  const [cancelFreeHours, setCancelFreeHours] = useState(
    initial.cancel_free_hours
  );
  const [bookFreeHours, setBookFreeHours] = useState(initial.book_free_hours);
  const [swapFreeHours, setSwapFreeHours] = useState(initial.swap_free_hours);
  const [billingDay, setBillingDay] = useState(initial.billing_day);
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
        allow_student_cancel: allowCancel,
        allow_student_swap: allowSwap,
        swap_needs_approval: swapNeedsApproval,
        cancel_free_hours: cancelFreeHours,
        book_free_hours: bookFreeHours,
        swap_free_hours: swapFreeHours,
        billing_day: billingDay,
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

      <div>
        <label className="text-sm font-medium">정산일 (매달 며칠)</label>
        <input
          type="number"
          min={1}
          max={28}
          value={billingDay}
          onChange={(e) => setBillingDay(Number(e.target.value))}
          className="num mt-1 w-full rounded-xl border border-line bg-card px-4 py-3"
        />
        <p className="mt-1 text-xs text-ink-soft">
          예: 10일이면 지난달 11일~이번달 10일 동안 온 만큼을 정산해요 (1~28일)
        </p>
      </div>

      <hr className="border-line" />

      <div className="space-y-4">
        <div>
          <p className="text-sm font-semibold">예약·취소 규칙</p>
          <p className="mt-1 text-xs text-ink-soft">
            수업까지 남은 시간이 기준보다 <b>많으면</b> 학생이 바로 처리하고,
            기준 <b>안쪽</b>이면 나에게 승인 요청이 와요.
          </p>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-sm font-medium">예약 자유 기준 (시간)</label>
            <input
              type="number"
              min={0}
              value={bookFreeHours}
              onChange={(e) => setBookFreeHours(Number(e.target.value))}
              className="num mt-1 w-full rounded-xl border border-line bg-card px-4 py-3"
            />
            <p className="mt-1 text-xs text-ink-soft">
              {bookFreeHours}시간 안쪽이면 예약 신청 → 내 승인
            </p>
          </div>
          <div className="flex-1">
            <label className="text-sm font-medium">취소 자유 기준 (시간)</label>
            <input
              type="number"
              min={0}
              value={cancelFreeHours}
              onChange={(e) => setCancelFreeHours(Number(e.target.value))}
              className="num mt-1 w-full rounded-xl border border-line bg-card px-4 py-3"
            />
            <p className="mt-1 text-xs text-ink-soft">
              {cancelFreeHours}시간 안쪽이면 취소 요청 → 내 승인
            </p>
          </div>
        </div>

        <Toggle
          checked={allowCancel}
          onChange={setAllowCancel}
          label="학생이 직접 취소할 수 있게 하기"
          hint="끄면 학생은 아예 취소할 수 없고, 나에게 직접 말해야 해요"
        />
        <Toggle
          checked={allowSwap}
          onChange={setAllowSwap}
          label="학생끼리 시간 교환 허용"
          hint="끄면 학생이 서로 시간을 바꾸자고 요청할 수 없어요"
        />
        {allowSwap && (
          <div className="space-y-3 border-l-2 border-line pl-4">
            <div>
              <label className="text-sm font-medium">교환 자유 기준 (시간)</label>
              <input
                type="number"
                min={0}
                disabled={swapNeedsApproval}
                value={swapFreeHours}
                onChange={(e) => setSwapFreeHours(Number(e.target.value))}
                className="num mt-1 w-full rounded-xl border border-line bg-card px-4 py-3 disabled:opacity-40"
              />
              <p className="mt-1 text-xs text-ink-soft">
                두 수업 중 <b>더 임박한 쪽</b>이 {swapFreeHours}시간보다 남았으면
                학생끼리 합의만으로 바로 바뀌고, 안쪽이면 내 승인을 거쳐요
              </p>
            </div>
            <Toggle
              checked={swapNeedsApproval}
              onChange={setSwapNeedsApproval}
              label="시간과 상관없이 항상 내 승인 받기"
              hint="켜면 위 기준을 무시하고 모든 교환이 내 승인을 거쳐요"
            />
          </div>
        )}
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
