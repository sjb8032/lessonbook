"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ClassRow } from "@/lib/types";
import {
  createClass,
  updateClass,
  setClassArchived,
  setClassMember,
} from "@/actions/classes";

type Student = { enrollment_id: string; name: string };

export default function ClassManager({
  classes,
  students,
  memberships,
}: {
  classes: ClassRow[];
  students: Student[];
  memberships: { class_id: string; enrollment_id: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // "classId:enrollmentId" 집합으로 소속 여부를 관리 (토글이 부드럽게)
  const [members, setMembers] = useState<Set<string>>(
    () => new Set(memberships.map((m) => `${m.class_id}:${m.enrollment_id}`))
  );
  const [counts, setCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(classes.map((c) => [c.id, c.member_count]))
  );

  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  function run(fn: () => Promise<{ error: string | null }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else {
        after?.();
        router.refresh();
      }
    });
  }

  function toggleMember(classId: string, enrollmentId: string) {
    const key = `${classId}:${enrollmentId}`;
    const willAdd = !members.has(key);
    // 낙관적 반영
    setMembers((prev) => {
      const next = new Set(prev);
      if (willAdd) next.add(key);
      else next.delete(key);
      return next;
    });
    setCounts((prev) => ({
      ...prev,
      [classId]: (prev[classId] ?? 0) + (willAdd ? 1 : -1),
    }));
    setError(null);
    startTransition(async () => {
      const res = await setClassMember(classId, enrollmentId, willAdd);
      if (res.error) {
        // 실패 시 되돌림
        setMembers((prev) => {
          const next = new Set(prev);
          if (willAdd) next.delete(key);
          else next.add(key);
          return next;
        });
        setCounts((prev) => ({
          ...prev,
          [classId]: (prev[classId] ?? 0) + (willAdd ? -1 : 1),
        }));
        setError(res.error);
      }
    });
  }

  const active = classes.filter((c) => !c.archived);
  const archived = classes.filter((c) => c.archived);

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-redpen">{error}</p>}

      {creating ? (
        <ClassForm
          pending={pending}
          onCancel={() => setCreating(false)}
          onSubmit={(name, desc) =>
            run(() => createClass(name, desc), () => setCreating(false))
          }
        />
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="w-full rounded-xl border border-dashed border-line py-3 text-sm font-medium text-ink-soft hover:border-pen hover:text-pen"
        >
          + 새 반 만들기
        </button>
      )}

      {active.length === 0 && !creating && (
        <p className="rounded-2xl border border-line bg-card p-6 text-center text-sm text-ink-soft">
          아직 만든 반이 없어요. 반을 만들면 학생을 넣고, 시간표에서 그 반만
          예약할 수 있는 시간을 열 수 있어요.
        </p>
      )}

      {active.map((c) =>
        editing === c.id ? (
          <ClassForm
            key={c.id}
            initialName={c.name}
            initialDesc={c.description ?? ""}
            pending={pending}
            onCancel={() => setEditing(null)}
            onSubmit={(name, desc) =>
              run(() => updateClass(c.id, name, desc), () => setEditing(null))
            }
          />
        ) : (
          <div key={c.id} className="rounded-2xl border border-line bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{c.name}</p>
                {c.description && (
                  <p className="mt-0.5 text-sm text-ink-soft">{c.description}</p>
                )}
                <p className="mt-1 text-xs text-ink-soft">
                  학생 {counts[c.id] ?? 0}명
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => setEditing(c.id)}
                  className="rounded-lg px-2 py-1 text-xs text-ink-soft hover:bg-line/50"
                >
                  편집
                </button>
                <button
                  disabled={pending}
                  onClick={() => run(() => setClassArchived(c.id, true))}
                  className="rounded-lg px-2 py-1 text-xs text-ink-soft hover:bg-line/50"
                >
                  보관
                </button>
              </div>
            </div>

            <button
              onClick={() => setExpanded(expanded === c.id ? null : c.id)}
              className="mt-3 w-full rounded-lg bg-pen-soft py-2 text-sm font-medium text-pen"
            >
              {expanded === c.id ? "닫기" : "학생 관리"}
            </button>

            {expanded === c.id && (
              <div className="mt-3 border-t border-line pt-3">
                {students.length === 0 ? (
                  <p className="text-sm text-ink-soft">
                    아직 연결된 학생이 없어요. 학생이 가입 코드로 연결하면 여기서
                    반에 넣을 수 있어요.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {students.map((s) => {
                      const on = members.has(`${c.id}:${s.enrollment_id}`);
                      return (
                        <li key={s.enrollment_id}>
                          <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-line/30">
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() =>
                                toggleMember(c.id, s.enrollment_id)
                              }
                              className="h-5 w-5 accent-[var(--color-pen)]"
                            />
                            <span className="text-sm">{s.name}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        )
      )}

      {archived.length > 0 && (
        <div className="pt-2">
          <p className="px-1 text-xs font-semibold text-ink-soft">보관된 반</p>
          <div className="mt-2 space-y-2">
            {archived.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-xl border border-line bg-card px-4 py-3"
              >
                <span className="text-sm text-ink-soft">{c.name}</span>
                <button
                  disabled={pending}
                  onClick={() => run(() => setClassArchived(c.id, false))}
                  className="rounded-lg px-2 py-1 text-xs text-pen hover:bg-pen-soft"
                >
                  복원
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ClassForm({
  initialName = "",
  initialDesc = "",
  pending,
  onSubmit,
  onCancel,
}: {
  initialName?: string;
  initialDesc?: string;
  pending: boolean;
  onSubmit: (name: string, desc: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [desc, setDesc] = useState(initialDesc);

  return (
    <div className="rounded-2xl border border-pen bg-card p-4">
      <label className="text-sm font-medium">반 이름</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="예: 피아노 취미반, 보컬 전문가반"
        className="mt-1 w-full rounded-xl border border-line bg-card px-4 py-3"
        autoFocus
      />
      <label className="mt-3 block text-sm font-medium">설명 (선택)</label>
      <input
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="반 소개나 메모"
        className="mt-1 w-full rounded-xl border border-line bg-card px-4 py-3"
      />
      <div className="mt-4 flex gap-2">
        <button
          disabled={pending || !name.trim()}
          onClick={() => onSubmit(name, desc)}
          className="flex-1 rounded-xl bg-pen py-3 font-semibold text-white disabled:opacity-50"
        >
          저장
        </button>
        <button
          onClick={onCancel}
          className="rounded-xl border border-line px-5 py-3 text-ink-soft"
        >
          취소
        </button>
      </div>
    </div>
  );
}
