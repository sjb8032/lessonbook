"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BillingMethod, ClassRow } from "@/lib/types";
import { fmtRate } from "@/lib/utils";
import {
  createClass,
  updateClass,
  setClassArchived,
  setClassMember,
  setMemberBilling,
} from "@/actions/classes";

type Student = { enrollment_id: string; name: string };
type FormValues = {
  name: string;
  description: string;
  price: number;
  default_billing_method: BillingMethod;
  default_prepay_sessions: number;
};
type Billing = { method: BillingMethod; prepay: number | null };

type MembershipRow = {
  class_id: string;
  enrollment_id: string;
  billing_method: BillingMethod;
  prepay_sessions: number | null;
};

const key = (classId: string, enr: string) => `${classId}:${enr}`;

export default function ClassManager({
  classes,
  students,
  memberships,
}: {
  classes: ClassRow[];
  students: Student[];
  memberships: MembershipRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // "classId:enrollmentId" → 결제 방식. Map 에 있으면 소속.
  const [members, setMembers] = useState<Map<string, Billing>>(
    () =>
      new Map(
        memberships.map((m) => [
          key(m.class_id, m.enrollment_id),
          { method: m.billing_method, prepay: m.prepay_sessions },
        ])
      )
  );

  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const memberCount = (classId: string) =>
    [...members.keys()].filter((k) => k.startsWith(`${classId}:`)).length;

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

  function toggleMember(classId: string, enr: string) {
    const k = key(classId, enr);
    const willAdd = !members.has(k);
    // 새로 넣는 학생은 반 기본 결제 방식을 물려받는다 (서버 트리거와 동일)
    const cls = classes.find((c) => c.id === classId);
    const inherited: Billing =
      cls?.default_billing_method === "prepay"
        ? { method: "prepay", prepay: cls.default_prepay_sessions }
        : { method: "monthly", prepay: null };
    setMembers((prev) => {
      const next = new Map(prev);
      if (willAdd) next.set(k, inherited);
      else next.delete(k);
      return next;
    });
    setError(null);
    startTransition(async () => {
      const res = await setClassMember(classId, enr, willAdd);
      if (res.error) {
        // 실패 시 되돌림
        setMembers((prev) => {
          const next = new Map(prev);
          if (willAdd) next.delete(k);
          else next.set(k, inherited);
          return next;
        });
        setError(res.error);
      }
    });
  }

  function commitBilling(
    classId: string,
    enr: string,
    method: BillingMethod,
    prepay: number | null
  ) {
    const k = key(classId, enr);
    setMembers((prev) => {
      const next = new Map(prev);
      next.set(k, { method, prepay });
      return next;
    });
    setError(null);
    startTransition(async () => {
      const res = await setMemberBilling(classId, enr, method, prepay);
      if (res.error) setError(res.error);
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
          onSubmit={(form) =>
            run(() => createClass(form), () => setCreating(false))
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
          아직 만든 반이 없어요. 반을 만들면 학생을 넣고, 학생마다 결제 방식을
          정할 수 있어요.
        </p>
      )}

      {active.map((c) =>
        editing === c.id ? (
          <ClassForm
            key={c.id}
            initial={{
              name: c.name,
              description: c.description ?? "",
              price: c.price,
              default_billing_method: c.default_billing_method,
              default_prepay_sessions: c.default_prepay_sessions,
            }}
            pending={pending}
            onCancel={() => setEditing(null)}
            onSubmit={(form) =>
              run(() => updateClass(c.id, form), () => setEditing(null))
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
                  학생 {memberCount(c.id)}명 ·{" "}
                  <span className="num">{fmtRate(c.price)}</span> · 기본{" "}
                  {c.default_billing_method === "prepay"
                    ? `${c.default_prepay_sessions}회 선불`
                    : "달마다 정산"}
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
              {expanded === c.id ? "닫기" : "학생 · 결제 방식"}
            </button>

            {expanded === c.id && (
              <div className="mt-3 space-y-2 border-t border-line pt-3">
                {students.length === 0 ? (
                  <p className="text-sm text-ink-soft">
                    아직 연결된 학생이 없어요. 학생이 가입 코드로 연결하면 여기서
                    반에 넣을 수 있어요.
                  </p>
                ) : (
                  students.map((s) => {
                    const billing = members.get(key(c.id, s.enrollment_id));
                    const isMember = !!billing;
                    return (
                      <div
                        key={s.enrollment_id}
                        className="rounded-xl bg-line/20 p-2"
                      >
                        <label className="flex cursor-pointer items-center gap-3 px-1 py-1">
                          <input
                            type="checkbox"
                            checked={isMember}
                            onChange={() =>
                              toggleMember(c.id, s.enrollment_id)
                            }
                            className="h-5 w-5 accent-[var(--color-pen)]"
                          />
                          <span className="text-sm font-medium">{s.name}</span>
                        </label>

                        {isMember && billing && (
                          <MemberBilling
                            billing={billing}
                            rate={c.price}
                            onChange={(method, prepay) =>
                              commitBilling(
                                c.id,
                                s.enrollment_id,
                                method,
                                prepay
                              )
                            }
                          />
                        )}
                      </div>
                    );
                  })
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

/** 한 학생의 결제 방식: 월 정산 / 선불 N회 */
function MemberBilling({
  billing,
  rate,
  onChange,
}: {
  billing: Billing;
  rate: number;
  onChange: (method: BillingMethod, prepay: number | null) => void;
}) {
  const [n, setN] = useState(billing.prepay ?? 4);

  return (
    <div className="mt-1 pl-8">
      <div className="flex gap-1 rounded-lg bg-card p-1">
        <button
          onClick={() => onChange("monthly", null)}
          className={`flex-1 rounded-md py-1.5 text-xs font-medium ${
            billing.method === "monthly"
              ? "bg-pen-soft text-pen"
              : "text-ink-soft"
          }`}
        >
          월 정산
        </button>
        <button
          onClick={() => onChange("prepay", n)}
          className={`flex-1 rounded-md py-1.5 text-xs font-medium ${
            billing.method === "prepay"
              ? "bg-pen-soft text-pen"
              : "text-ink-soft"
          }`}
        >
          선불
        </button>
      </div>

      {billing.method === "prepay" ? (
        <div className="mt-1.5 flex items-center gap-2 text-xs text-ink-soft">
          <input
            type="number"
            min={1}
            value={n}
            onChange={(e) => setN(Number(e.target.value))}
            onBlur={() => onChange("prepay", n)}
            className="num w-16 rounded-lg border border-line bg-card px-2 py-1.5 text-center"
          />
          <span className="num">
            회씩 선불 · {(rate * n).toLocaleString("ko-KR")}원
          </span>
        </div>
      ) : (
        <p className="mt-1.5 pl-1 text-xs text-ink-soft">
          정산일에 그 달 온 만큼 청구
        </p>
      )}
    </div>
  );
}

function ClassForm({
  initial,
  pending,
  onSubmit,
  onCancel,
}: {
  initial?: FormValues;
  pending: boolean;
  onSubmit: (form: FormValues) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [desc, setDesc] = useState(initial?.description ?? "");
  const [price, setPrice] = useState(initial?.price ?? 0);
  const [method, setMethod] = useState<BillingMethod>(
    initial?.default_billing_method ?? "monthly"
  );
  const [prepayN, setPrepayN] = useState(initial?.default_prepay_sessions ?? 4);

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

      <label className="mt-3 block text-sm font-medium">회차당 단가 (원)</label>
      <input
        type="number"
        min={0}
        step={1000}
        value={price}
        onChange={(e) => setPrice(Number(e.target.value))}
        className="num mt-1 w-full rounded-xl border border-line bg-card px-4 py-3"
      />
      <p className="mt-1 text-xs text-ink-soft">
        수업 한 번당 금액이에요. 아래 기본 방식으로 정산돼요.
      </p>

      <label className="mt-3 block text-sm font-medium">기본 결제 방식</label>
      <div className="mt-1 flex gap-1 rounded-xl bg-line/40 p-1">
        <button
          type="button"
          onClick={() => setMethod("monthly")}
          className={`flex-1 rounded-lg py-2 text-sm font-medium ${
            method === "monthly" ? "bg-card text-pen shadow-sm" : "text-ink-soft"
          }`}
        >
          달마다 정산
        </button>
        <button
          type="button"
          onClick={() => setMethod("prepay")}
          className={`flex-1 rounded-lg py-2 text-sm font-medium ${
            method === "prepay" ? "bg-card text-pen shadow-sm" : "text-ink-soft"
          }`}
        >
          회차 선불
        </button>
      </div>
      {method === "prepay" ? (
        <div className="mt-2 flex items-center gap-2 text-sm text-ink-soft">
          <input
            type="number"
            min={1}
            value={prepayN}
            onChange={(e) => setPrepayN(Number(e.target.value))}
            className="num w-20 rounded-xl border border-line bg-card px-3 py-2 text-center"
          />
          <span className="num">
            회씩 미리 받기 · {(price * prepayN).toLocaleString("ko-KR")}원
          </span>
        </div>
      ) : (
        <p className="mt-1 text-xs text-ink-soft">
          정산일마다 그 달 온 만큼 청구해요
        </p>
      )}
      <p className="mt-1 text-xs text-ink-soft">
        새로 반에 넣는 학생에게 적용돼요. 학생마다 따로 바꿀 수도 있어요.
      </p>

      <div className="mt-4 flex gap-2">
        <button
          disabled={pending || !name.trim()}
          onClick={() =>
            onSubmit({
              name,
              description: desc,
              price,
              default_billing_method: method,
              default_prepay_sessions: prepayN,
            })
          }
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
