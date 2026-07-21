-- =============================================================
-- 0006: 반(수준)마다 가격  — 2단계(a)
--
--   price_mode:
--     per_session : 회차당 price 원
--     bundle      : bundle_size 회에 price 원 (묶음 결제)
--     period      : 한 기간(월)마다 price 원
-- =============================================================

alter table public.classes
  add column if not exists price_mode text not null default 'per_session'
    check (price_mode in ('per_session', 'bundle', 'period')),
  add column if not exists price int not null default 0,
  add column if not exists bundle_size int;  -- bundle 모드에서만 사용

-- get_classes 에 가격 정보 추가
drop function if exists public.get_classes();
create function public.get_classes()
returns table (
  id uuid, name text, description text, archived boolean, member_count int,
  price_mode text, price int, bundle_size int
) language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.description, c.archived,
         (select count(*)::int from public.class_members m where m.class_id = c.id),
         c.price_mode, c.price, c.bundle_size
  from public.classes c
  where c.teacher_id = auth.uid()
  order by c.archived, c.created_at;
$$;

revoke execute on all functions in schema public from anon, public;
