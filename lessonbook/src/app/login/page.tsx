"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <h1 className="text-3xl font-bold tracking-tight">레슨북</h1>
      <p className="mt-2 text-ink-soft">
        레슨 예약, 회차, 일지를 한 곳에서.
      </p>

      {sent ? (
        <div className="mt-10 rounded-xl border border-line bg-card p-5">
          <p className="font-semibold">메일함을 확인해 주세요</p>
          <p className="mt-1 text-sm text-ink-soft">
            {email} 으로 로그인 링크를 보냈어요. 링크를 누르면 바로 시작돼요.
          </p>
        </div>
      ) : (
        <form onSubmit={sendLink} className="mt-10 space-y-3">
          <label className="block text-sm font-medium">이메일</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-xl border border-line bg-card px-4 py-3 outline-none focus:border-pen"
          />
          {error && <p className="text-sm text-redpen">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-pen py-3 font-semibold text-white disabled:opacity-50"
          >
            {loading ? "보내는 중…" : "로그인 링크 받기"}
          </button>
          <p className="pt-2 text-xs text-ink-soft">
            계정이 없어도 괜찮아요. 링크로 접속하면 자동으로 만들어져요.
          </p>
        </form>
      )}
    </main>
  );
}
