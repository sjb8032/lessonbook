import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

function fail(origin: string, message: string) {
  return `${origin}/login?error=${encodeURIComponent(message)}`;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const next = searchParams.get("next") ?? "/";

  // Supabase가 링크 만료/무효를 알려주는 경우
  const linkError =
    searchParams.get("error_description") ?? searchParams.get("error");
  if (linkError) return NextResponse.redirect(fail(origin, linkError));

  const supabase = await createClient();

  // PKCE 흐름: ?code=…
  const code = searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(fail(origin, error.message));
    return NextResponse.redirect(`${origin}${next}`);
  }

  // 이메일 템플릿이 {{ .TokenHash }} 를 쓰는 경우: ?token_hash=…&type=…
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (error) return NextResponse.redirect(fail(origin, error.message));
    return NextResponse.redirect(`${origin}${next}`);
  }

  // implicit 흐름: 토큰이 #access_token=… 해시로 와서 서버에서는 보이지 않음.
  // 브라우저에서 해시를 읽어 세션을 세우도록 넘긴다.
  return NextResponse.redirect(
    `${origin}/auth/callback/hash?next=${encodeURIComponent(next)}`
  );
}
