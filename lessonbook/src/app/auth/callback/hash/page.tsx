"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function AuthCallbackHash() {
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const next =
      new URLSearchParams(window.location.search).get("next") ?? "/";

    if (!accessToken || !refreshToken) {
      const message =
        params.get("error_description") ??
        "로그인 링크에 인증 정보가 없어요. 링크를 다시 받아 주세요.";
      router.replace(`/login?error=${encodeURIComponent(message)}`);
      return;
    }

    createClient()
      .auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      })
      .then(({ error }) => {
        if (error) {
          router.replace(`/login?error=${encodeURIComponent(error.message)}`);
          return;
        }
        router.replace(next);
      });
  }, [router]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <p className="text-ink-soft">로그인 중…</p>
    </main>
  );
}
