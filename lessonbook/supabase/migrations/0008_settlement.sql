-- =============================================================
-- 0008: 정산 — 2단계(b)
--
--   정산 창: billing_day(예: 10) 기준, 가장 최근 정산일이 창의 끝.
--     창 = [지난 정산일+1일 ~ 이번 정산일]  (예: 6/11 ~ 7/10)
--   월 정산(monthly) 학생: 창 안에서 완료한 수업 수 × 반 단가 = 청구액.
--     입금 확인 시 payments 에 (class_id, period_end=창 끝) 로 기록.
--   선불(prepay) 학생: payments(period_end null) 의 covers_sessions 합 - 전체 완료 수 = 잔여.
--     소진되면 충전(다음 N회분) 기록.
-- =============================================================

alter table public.payments
  add column if not exists class_id uuid references public.classes (id) on delete set null,
  add column if not exists period_end date;  -- 월 정산 창의 끝 (선불 충전은 null)

-- 같은 창을 두 번 입금 확인하는 것 방지
create unique index if not exists payments_settlement_once
  on public.payments (enrollment_id, class_id, period_end)
  where period_end is not null;

-- ---------- 정산 창 계산 (내부용) ----------

create or replace function public._settlement_window(p_teacher uuid, out w_start date, out w_end date)
language plpgsql stable security definer set search_path = public as $$
declare v_day int; v_today date; v_anchor date;
begin
  select billing_day into v_day from public.teacher_settings where teacher_id = p_teacher;
  v_day := coalesce(v_day, 1);
  v_today := (now() at time zone 'Asia/Seoul')::date;
  -- 이번 달의 정산일. 아직 안 왔으면 지난달 정산일이 가장 최근.
  v_anchor := make_date(extract(year from v_today)::int, extract(month from v_today)::int, v_day);
  if v_today < v_anchor then
    v_anchor := (v_anchor - interval '1 month')::date;
  end if;
  w_end := v_anchor;
  w_start := ((v_anchor - interval '1 month')::date + 1);
end $$;

-- ---------- 정산 현황 조회 ----------

create or replace function public.get_settlement()
returns table (
  class_id uuid, class_name text, price int,
  enrollment_id uuid, student_name text,
  billing_method text, prepay_sessions int,
  window_start date, window_end date,
  window_count int, window_amount int, window_paid boolean,
  prepaid_total int, completed_total int, prepay_remaining int
) language plpgsql stable security definer set search_path = public as $$
declare w record;
begin
  select * into w from public._settlement_window(auth.uid());
  return query
  select
    c.id, c.name, c.price,
    e.id, p.name,
    m.billing_method, m.prepay_sessions,
    w.w_start, w.w_end,
    cnt.win::int,
    (cnt.win * c.price)::int,
    exists (select 1 from public.payments pay
            where pay.enrollment_id = e.id and pay.class_id = c.id
              and pay.period_end = w.w_end),
    coalesce(pp.total, 0)::int,
    cnt.total::int,
    (coalesce(pp.total, 0) - cnt.total)::int
  from public.class_members m
  join public.classes c on c.id = m.class_id
  join public.enrollments e on e.id = m.enrollment_id
  join public.profiles p on p.id = e.student_id
  left join lateral (
    select
      count(*) filter (
        where (s.starts_at at time zone 'Asia/Seoul')::date between w.w_start and w.w_end
      ) as win,
      count(*) as total
    from public.bookings b
    join public.slots s on s.id = b.slot_id
    where b.enrollment_id = e.id and b.class_id = c.id
      and b.status = 'completed' and b.kind = 'lesson'
  ) cnt on true
  left join lateral (
    -- 선불 충전만 (월 정산 기록은 period_end 가 있으므로 제외)
    select sum(covers_sessions) as total from public.payments pay
    where pay.enrollment_id = e.id and pay.class_id = c.id and pay.period_end is null
  ) pp on true
  where c.teacher_id = auth.uid() and c.archived = false and e.status = 'active'
  order by c.name, p.name;
end $$;

-- ---------- 입금 확인 / 취소 / 선불 충전 ----------

-- 월 정산: 이번 창 입금 확인
create or replace function public.confirm_settlement(p_class uuid, p_enrollment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  w record; v_price int; v_name text; v_student uuid; v_cnt int;
begin
  select price, name into v_price, v_name from public.classes
  where id = p_class and teacher_id = auth.uid();
  if v_price is null then raise exception '권한이 없어요'; end if;

  select student_id into v_student from public.enrollments
  where id = p_enrollment and teacher_id = auth.uid();
  if v_student is null then raise exception '학생을 찾을 수 없어요'; end if;

  select * into w from public._settlement_window(auth.uid());

  select count(*)::int into v_cnt
  from public.bookings b join public.slots s on s.id = b.slot_id
  where b.enrollment_id = p_enrollment and b.class_id = p_class
    and b.status = 'completed' and b.kind = 'lesson'
    and (s.starts_at at time zone 'Asia/Seoul')::date between w.w_start and w.w_end;

  if v_cnt = 0 then raise exception '이번 정산 기간에 완료한 수업이 없어요'; end if;

  begin
    insert into public.payments (enrollment_id, amount, covers_sessions, note, class_id, period_end)
    values (p_enrollment, v_cnt * v_price, v_cnt,
            v_name || ' ' || to_char(w.w_end, 'MM/DD') || ' 정산', p_class, w.w_end);
  exception when unique_violation then
    raise exception '이미 입금 확인한 정산이에요';
  end;

  perform public.notify(v_student, 'payment_confirmed',
    v_name || ' ' || to_char(w.w_end, 'MM/DD') || ' 정산(' || v_cnt || '회, ' ||
    to_char(v_cnt * v_price, 'FM999,999,999') || '원) 입금이 확인됐어요', '/s/me');
end $$;

-- 월 정산: 입금 확인 취소 (잘못 눌렀을 때)
create or replace function public.cancel_settlement(p_class uuid, p_enrollment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare w record; v_cnt int;
begin
  if not exists (select 1 from public.classes where id = p_class and teacher_id = auth.uid()) then
    raise exception '권한이 없어요';
  end if;
  select * into w from public._settlement_window(auth.uid());
  delete from public.payments
  where enrollment_id = p_enrollment and class_id = p_class and period_end = w.w_end;
  get diagnostics v_cnt = row_count;
  if v_cnt = 0 then raise exception '취소할 입금 기록이 없어요'; end if;
end $$;

-- 선불 충전 (N회분 입금 확인)
create or replace function public.add_prepay(p_class uuid, p_enrollment uuid, p_sessions int)
returns void language plpgsql security definer set search_path = public as $$
declare v_price int; v_name text; v_student uuid;
begin
  if p_sessions is null or p_sessions < 1 then
    raise exception '충전 회차 수를 1 이상으로 입력해 주세요';
  end if;

  select price, name into v_price, v_name from public.classes
  where id = p_class and teacher_id = auth.uid();
  if v_price is null then raise exception '권한이 없어요'; end if;

  select student_id into v_student from public.enrollments
  where id = p_enrollment and teacher_id = auth.uid();
  if v_student is null then raise exception '학생을 찾을 수 없어요'; end if;

  insert into public.payments (enrollment_id, amount, covers_sessions, note, class_id)
  values (p_enrollment, p_sessions * v_price, p_sessions,
          v_name || ' 선불 ' || p_sessions || '회', p_class);

  perform public.notify(v_student, 'payment_confirmed',
    v_name || ' 선불 ' || p_sessions || '회(' ||
    to_char(p_sessions * v_price, 'FM999,999,999') || '원) 입금이 확인됐어요', '/s/me');
end $$;

-- ---------- 권한 ----------

revoke execute on all functions in schema public from anon, public;
revoke execute on function public._settlement_window(uuid) from authenticated;
