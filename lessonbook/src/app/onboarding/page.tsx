"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setupTeacher, setupStudent } from "@/actions/onboarding";
import type { Role } from "@/lib/types";

export default function OnboardingPage() {
  const router = useRouter();
  const [role, setRole] = useState<Role | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!role) return;
    setLoading(true);
    setError(null);
    const res =
      role === "teacher"
        ? await setupTeacher(name, phone)
        : await setupStudent(name, phone, code);
    setLoading(false);
    if (res.error) setError(res.error);
    else router.push(role === "teacher" ? "/t/schedule" : "/s/schedule");
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-10">
      <h1 className="text-2xl font-bold">시작하기</h1>

      {!role ? (
        <div className="mt-8 space-y-3">
          <p className="text-sm text-ink-soft">어떤 역할로 사용하시나요?</p>
          <button
            onClick={() => setRole("teacher")}
            className="w-full rounded-xl border border-line bg-card p-5 text-left hover:border-pen"
          >
            <p className="font-semibold">선생님이에요</p>
            <p className="mt-1 text-sm text-ink-soft">
              레슨 시간을 열고, 수강생·회차·일지를 관리해요
            </p>
          </button>
          <button
            onClick={() => setRole("student")}
            className="w-full rounded-xl border border-line bg-card p-5 text-left hover:border-pen"
          >
            <p className="font-semibold">수강생이에요</p>
            <p className="mt-1 text-sm text-ink-soft">
              선생님의 가입 코드로 연결하고 수업을 예약해요
            </p>
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-8 space-y-4">
          <div>
            <label className="block text-sm font-medium">이름</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="홍길동"
              className="mt-1 w-full rounded-xl border border-line bg-card px-4 py-3 outline-none focus:border-pen"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">
              연락처 <span className="text-ink-soft">(선택)</span>
            </label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="010-0000-0000"
              className="mt-1 w-full rounded-xl border border-line bg-card px-4 py-3 outline-none focus:border-pen"
            />
          </div>
          {role === "student" && (
            <div>
              <label className="block text-sm font-medium">선생님 가입 코드</label>
              <input
                required
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="예: A1B2C3"
                className="num mt-1 w-full rounded-xl border border-line bg-card px-4 py-3 uppercase tracking-widest outline-none focus:border-pen"
              />
              <p className="mt-1 text-xs text-ink-soft">
                선생님께 6자리 코드를 받아 입력해 주세요
              </p>
            </div>
          )}
          {error && <p className="text-sm text-redpen">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-pen py-3 font-semibold text-white disabled:opacity-50"
          >
            {loading ? "설정 중…" : "레슨북 시작"}
          </button>
          <button
            type="button"
            onClick={() => setRole(null)}
            className="w-full py-2 text-sm text-ink-soft"
          >
            ← 역할 다시 선택
          </button>
        </form>
      )}
    </main>
  );
}
