-- =============================================================
-- 0011: 반 기본 결제 방식
--
--   반을 만들 때 "달마다 정산 / 회차 선불" 중 기본값을 정한다.
--   학생을 반에 넣으면 이 기본값을 물려받고, 학생별로 바꿀 수도 있다.
-- =============================================================

alter table public.classes
  add column if not exists default_billing_method text not null default 'monthly'
    check (default_billing_method in ('monthly', 'prepay')),
  add column if not exists default_prepay_sessions int not null default 4
    check (default_prepay_sessions >= 1);

drop function if exists public.get_classes();
create function public.get_classes()
returns table (
  id uuid, name text, description text, archived boolean, member_count int,
  price int, default_billing_method text, default_prepay_sessions int
) language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.description, c.archived,
         (select count(*)::int from public.class_members m where m.class_id = c.id),
         c.price, c.default_billing_method, c.default_prepay_sessions
  from public.classes c
  where c.teacher_id = auth.uid()
  order by c.archived, c.created_at;
$$;

-- 학생을 반에 넣을 때 반 기본값을 물려받도록 트리거로 처리
-- (insert 시 billing_method 를 명시하지 않으면 반 기본값 사용)
create or replace function public._class_member_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_method text; v_n int;
begin
  select default_billing_method, default_prepay_sessions into v_method, v_n
  from public.classes where id = new.class_id;
  if new.billing_method is null or new.billing_method = 'monthly' then
    -- 명시 없이 들어온 기본('monthly')이면 반 기본값으로 대체
    new.billing_method := coalesce(v_method, 'monthly');
  end if;
  if new.billing_method = 'prepay' and new.prepay_sessions is null then
    new.prepay_sessions := coalesce(v_n, 4);
  end if;
  return new;
end $$;

drop trigger if exists class_member_defaults on public.class_members;
create trigger class_member_defaults
  before insert on public.class_members
  for each row execute function public._class_member_defaults();

revoke execute on all functions in schema public from anon, public;
