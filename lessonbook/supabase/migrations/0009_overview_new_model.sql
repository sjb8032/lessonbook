-- =============================================================
-- 0009: 학생 탭 · 내 수강 화면을 새 정산 모델로
--
--   get_students_overview: 옛 사이클(잔여 회차) 대신
--     소속 반 이름들 + 이번 창 미입금 청구액(due_amount) + 선불 소진 여부
--   get_my_billing: 학생용 — 내가 속한 반별로 단가/이번 창 횟수·금액/선불 잔여
--   get_my_summary(옛 사이클 요약)는 제거
-- =============================================================

drop function if exists public.get_students_overview();
create function public.get_students_overview()
returns table (
  enrollment_id uuid, student_id uuid, student_name text, phone text,
  started_at date, teacher_memo text, last_lesson date,
  completed int, class_names text, due_amount int, prepay_depleted boolean
) language plpgsql stable security definer set search_path = public as $$
declare w record;
begin
  select * into w from public._settlement_window(auth.uid());
  return query
  select
    e.id, p.id, p.name, p.phone, e.started_at, e.teacher_memo,
    lessons.last_done,
    coalesce(lessons.cnt, 0)::int,
    cls.names,
    coalesce(due.amt, 0)::int,
    coalesce(dep.depleted, false)
  from public.enrollments e
  join public.profiles p on p.id = e.student_id
  left join lateral (
    select count(*) as cnt,
           max((s.starts_at at time zone 'Asia/Seoul'))::date as last_done
    from public.bookings b join public.slots s on s.id = b.slot_id
    where b.enrollment_id = e.id and b.status = 'completed' and b.kind = 'lesson'
  ) lessons on true
  left join lateral (
    select string_agg(c.name, ', ' order by c.name) as names
    from public.class_members m join public.classes c on c.id = m.class_id
    where m.enrollment_id = e.id and c.archived = false
  ) cls on true
  left join lateral (
    -- 월 정산 반들 중, 이번 창에 아직 입금 확인 안 된 청구액 합
    select sum(cnt2.win * c.price) as amt
    from public.class_members m
    join public.classes c on c.id = m.class_id
    left join lateral (
      select count(*) filter (
        where (s.starts_at at time zone 'Asia/Seoul')::date between w.w_start and w.w_end
      ) as win
      from public.bookings b join public.slots s on s.id = b.slot_id
      where b.enrollment_id = e.id and b.class_id = c.id
        and b.status = 'completed' and b.kind = 'lesson'
    ) cnt2 on true
    where m.enrollment_id = e.id and m.billing_method = 'monthly' and c.archived = false
      and not exists (select 1 from public.payments pay
                      where pay.enrollment_id = e.id and pay.class_id = c.id
                        and pay.period_end = w.w_end)
  ) due on true
  left join lateral (
    -- 선불 반 중 하나라도 잔여 ≤ 0 이면 소진
    select bool_or(coalesce(pp.total, 0) - coalesce(ct.total, 0) <= 0) as depleted
    from public.class_members m
    join public.classes c on c.id = m.class_id
    left join lateral (
      select sum(covers_sessions) as total from public.payments pay
      where pay.enrollment_id = e.id and pay.class_id = c.id and pay.period_end is null
    ) pp on true
    left join lateral (
      select count(*) as total from public.bookings b
      where b.enrollment_id = e.id and b.class_id = c.id
        and b.status = 'completed' and b.kind = 'lesson'
    ) ct on true
    where m.enrollment_id = e.id and m.billing_method = 'prepay' and c.archived = false
  ) dep on true
  where e.teacher_id = auth.uid() and e.status = 'active'
  order by p.name;
end $$;

-- 학생용: 내가 속한 반별 정산 현황
create or replace function public.get_my_billing()
returns table (
  teacher_name text, class_id uuid, class_name text, price int, billing_method text,
  window_start date, window_end date, window_count int, window_amount int, window_paid boolean,
  prepaid_total int, completed_total int, prepay_remaining int
) language plpgsql stable security definer set search_path = public as $$
begin
  return query
  select
    tp.name, c.id, c.name, c.price, m.billing_method,
    w.w_start, w.w_end,
    cnt.win::int,
    (cnt.win * c.price)::int,
    exists (select 1 from public.payments pay
            where pay.enrollment_id = e.id and pay.class_id = c.id
              and pay.period_end = w.w_end),
    coalesce(pp.total, 0)::int,
    cnt.total::int,
    (coalesce(pp.total, 0) - cnt.total)::int
  from public.enrollments e
  join public.class_members m on m.enrollment_id = e.id
  join public.classes c on c.id = m.class_id and c.archived = false
  join public.profiles tp on tp.id = e.teacher_id
  cross join lateral public._settlement_window(e.teacher_id) w
  left join lateral (
    select
      count(*) filter (
        where (s.starts_at at time zone 'Asia/Seoul')::date between w.w_start and w.w_end
      ) as win,
      count(*) as total
    from public.bookings b join public.slots s on s.id = b.slot_id
    where b.enrollment_id = e.id and b.class_id = c.id
      and b.status = 'completed' and b.kind = 'lesson'
  ) cnt on true
  left join lateral (
    select sum(covers_sessions) as total from public.payments pay
    where pay.enrollment_id = e.id and pay.class_id = c.id and pay.period_end is null
  ) pp on true
  where e.student_id = auth.uid() and e.status = 'active'
  order by c.name;
end $$;

-- 옛 사이클 요약 제거
drop function if exists public.get_my_summary(uuid);

revoke execute on all functions in schema public from anon, public;
revoke execute on function public._settlement_window(uuid) from authenticated;
