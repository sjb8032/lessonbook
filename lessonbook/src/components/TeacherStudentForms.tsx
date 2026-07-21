"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveTeacherMemo } from "@/actions/journal";

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
