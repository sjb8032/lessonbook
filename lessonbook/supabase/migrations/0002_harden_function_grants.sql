-- =============================================================
-- 0002: 함수 실행 권한 하드닝
-- 문제: Postgres는 함수 생성 시 기본으로 PUBLIC(anon 포함)에 EXECUTE를 부여.
--       비로그인 호출은 auth.uid()가 NULL이라 `auth.uid() <> x` 비교가 NULL이 되어
--       권한 체크 raise를 조용히 건너뛸 수 있음 (SQL 3치 논리).
-- 해결: anon의 실행 권한을 전부 회수 → 비로그인 RPC 호출 원천 차단.
-- =============================================================

-- 비로그인(anon)과 PUBLIC의 모든 함수 실행 차단
revoke execute on all functions in schema public from anon, public;

-- 내부 전용 함수는 로그인 사용자도 직접 호출 불가
-- (다른 security definer 함수 내부에서만 사용됨)
revoke execute on function public.notify(uuid, text, text, text) from authenticated;
revoke execute on function public.effective_cycle(uuid) from authenticated;

-- 앞으로 만드는 함수도 기본적으로 anon 실행 불가
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, public;

-- mask_name의 search_path 고정 (linter 0011)
alter function public.mask_name(text) set search_path = public;
