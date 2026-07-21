-- =============================================================
-- 0007: 정산 모델 정리 — 2단계(b 준비)
--
--   반(class): price = 회차당 단가(원). (0006의 3-모드는 폐기)
--   학생×반(class_members): 결제 방식을 학생마다 지정
--     monthly : 정산일 기준 그 달 완료 횟수 × 단가
--     prepay  : N회분(prepay_sessions) 미리 내고 완료할 때마다 차감
--   teacher_settings.billing_day: 매달 정산하는 날 (창 = 지난 정산일 다음날 ~ 이번 정산일)
-- =============================================================

alter table public.classes drop column if exists price_mode;
alter table public.classes drop column if exists bundle_size;
-- classes.price 는 이제 "회차당 단가(원)"

alter table public.class_members
  add column if not exists billing_method text not null default 'monthly'
    check (billing_method in ('monthly', 'prepay')),
  add column if not exists prepay_sessions int;

alter table public.teacher_settings
  add column if not exists billing_day int not null default 1
    check (billing_day between 1 and 28);

-- get_classes: 단가만
drop function if exists public.get_classes();
create function public.get_classes()
returns table (
  id uuid, name text, description text, archived boolean, member_count int, price int
) language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.description, c.archived,
         (select count(*)::int from public.class_members m where m.class_id = c.id),
         c.price
  from public.classes c
  where c.teacher_id = auth.uid()
  order by c.archived, c.created_at;
$$;

-- get_class_roster: 멤버의 결제 방식도 함께
drop function if exists public.get_class_roster(uuid);
create function public.get_class_roster(p_class uuid)
returns table (
  enrollment_id uuid, student_name text, is_member boolean,
  billing_method text, prepay_sessions int
) language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.classes where id = p_class and teacher_id = auth.uid()) then
    raise exception '권한이 없어요';
  end if;
  return query
  select e.id, p.name,
         (m.class_id is not null),
         coalesce(m.billing_method, 'monthly'),
         m.prepay_sessions
  from public.enrollments e
  join public.profiles p on p.id = e.student_id
  left join public.class_members m on m.class_id = p_class and m.enrollment_id = e.id
  where e.teacher_id = auth.uid() and e.status = 'active'
  order by p.name;
end $$;

-- 완료 처리: 레거시 결제 알림 제거. 완료 + 회차만 (정산은 정산 탭이 담당)
drop function if exists public.complete_lesson(uuid);
create function public.complete_lesson(p_booking uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v record; v_next_no int;
begin
  select b.id, b.status, b.enrollment_id, b.kind, b.class_id,
         s.teacher_id, s.starts_at, e.student_id
    into v
  from public.bookings b
  join public.slots s on s.id = b.slot_id
  join public.enrollments e on e.id = b.enrollment_id
  where b.id = p_booking for update of b;

  if v is null then raise exception '예약을 찾을 수 없어요'; end if;
  if auth.uid() <> v.teacher_id then raise exception '선생님만 완료 처리할 수 있어요'; end if;
  if v.status <> 'confirmed' then raise exception '이미 처리된 예약이에요'; end if;

  if v.kind <> 'lesson' then
    update public.bookings set status = 'completed', completed_at = now() where id = p_booking;
    return;
  end if;

  select coalesce(max(session_no), 0) + 1 into v_next_no
  from public.bookings
  where enrollment_id = v.enrollment_id
    and class_id is not distinct from v.class_id
    and status = 'completed';

  update public.bookings
  set status = 'completed', completed_at = now(), session_no = v_next_no
  where id = p_booking;

  perform public.notify(v.student_id, 'completed',
    to_char(v.starts_at at time zone 'Asia/Seoul', 'MM/DD') || ' 수업 완료', '/s/me');
end $$;

revoke execute on all functions in schema public from anon, public;
