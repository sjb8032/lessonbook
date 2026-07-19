"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { writeJournal } from "@/actions/journal";

export default function JournalForm({ enrollmentId }: { enrollmentId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const [date, setDate] = useState(iso);
  const [progress, setProgress] = useState("");
  const [notes, setNotes] = useState("");
  const [homework, setHomework] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await writeJournal(enrollmentId, null, date, progress, notes, homework);
      if (res.error) setError(res.error);
      else {
        setProgress("");
        setNotes("");
        setHomework("");
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="num rounded-lg border border-line bg-card px-3 py-2 text-sm"
      />
      <input
        value={progress}
        onChange={(e) => setProgress(e.target.value)}
        placeholder="진도 — 오늘 나간 내용"
        className="w-full rounded-lg border border-line bg-card px-3 py-2.5 text-sm"
      />
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="비고 — 특이사항, 피드백"
        rows={2}
        className="w-full rounded-lg border border-line bg-card px-3 py-2.5 text-sm"
      />
      <input
        value={homework}
        onChange={(e) => setHomework(e.target.value)}
        placeholder="과제 (선택)"
        className="w-full rounded-lg border border-line bg-card px-3 py-2.5 text-sm"
      />
      {error && <p className="text-sm text-redpen">{error}</p>}
      <button
        disabled={pending || (!progress && !notes && !homework)}
        className="w-full rounded-xl bg-pen py-2.5 text-sm font-semibold text-white disabled:opacity-40"
      >
        {saved ? "저장됐어요 ✓" : pending ? "저장 중…" : "일지 저장"}
      </button>
    </form>
  );
}
