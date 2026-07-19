"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const linkError = useSearchParams().get("error");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(linkError);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);
    const supabase = createClient();

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      setLoading(false);
      if (error) {
        setError(
          error.message === "Invalid login credentials"
            ? "이메일 또는 비밀번호가 맞지 않아요"
            : error.message
        );
        return;
      }
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password });
      setLoading(false);
      if (error) {
        setError(
          error.message === "User already registered"
            ? "이미 가입된 이메일이에요. 로그인으로 바꿔서 들어가 주세요"
            : error.message
        );
        return;
      }
      // 프로젝트에서 이메일 인증이 켜져 있으면 세션 없이 돌아온다
      if (!data.session) {
        setNotice(
          "가입은 됐는데 이메일 인증이 필요한 설정이에요. Supabase 대시보드에서 Confirm email을 꺼 주세요."
        );
        return;
      }
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <h1 className="text-3xl font-bold tracking-tight">레슨북</h1>
      <p className="mt-2 text-ink-soft">레슨 예약, 회차, 일지를 한 곳에서.</p>

      <form onSubmit={submit} className="mt-10 space-y-3">
        <label className="block text-sm font-medium">이메일</label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-xl border border-line bg-card px-4 py-3 outline-none focus:border-pen"
        />

        <label className="block text-sm font-medium">비밀번호</label>
        <input
          type="password"
          required
          minLength={6}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="6자 이상"
          className="w-full rounded-xl border border-line bg-card px-4 py-3 outline-none focus:border-pen"
        />

        {error && <p className="text-sm text-redpen">{error}</p>}
        {notice && <p className="text-sm text-ink-soft">{notice}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-pen py-3 font-semibold text-white disabled:opacity-50"
        >
          {loading
            ? "처리 중…"
            : mode === "signin"
            ? "로그인"
            : "가입하고 시작하기"}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setNotice(null);
          }}
          className="w-full py-2 text-sm text-ink-soft hover:text-pen"
        >
          {mode === "signin"
            ? "계정이 없어요 · 가입하기"
            : "이미 계정이 있어요 · 로그인"}
        </button>
      </form>
    </main>
  );
}
