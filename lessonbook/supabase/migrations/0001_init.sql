-- =============================================================
-- lessonbook v0+v1  |  스키마 + RLS + 핵심 트랜잭션 함수
-- Supabase SQL Editor에 이 파일 전체를 붙여넣고 실행하세요.
-- =============================================================

-- ---------- 테이블 ----------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('teacher', 'student')),
  name text not null,
  phone text,
  created_at timestamptz not null default now()
);

create table public.teacher_settings (
  teacher_id uuid primary key references public.profiles (id) on delete cascade,
  lesson_minutes int not null default 60,
  cycle_length int not null default 4,           -- 몇 회차마다 결제인지
  cycle_price int not null default 0,            -- 사이클당 수강료(원)
  bank_info text,                                -- 계좌 안내 텍스트
  payment_link text,                             -- 토스 송금 링크 등
  join_code text not null unique default upper(substr(md5(random()::text), 1, 6))
);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'paused', 'ended')),
  cycle_length int,                              -- null이면 선생님 기본값 사용
  cycle_price int,
  teacher_memo text,                             -- 선생님 전용 메모 (학생에게 비공개)
  started_at date not null default current_date,
  unique (teacher_id, student_id)
);

create table public.slots (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'booked')),
  unique (teacher_id, starts_at)
);
create index slots_teacher_time_idx on public.slots (teacher_id, starts_at);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.slots (id) on delete cascade,
  enrollment_id uuid not null references public.enrollments (id) on delete cascade,
  status text not null default 'confirmed' check (status in ('confirmed', 'completed', 'canceled')),
  session_no int,                                -- 완료 시점에 부여되는 회차 번호
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  canceled_at timestamptz
);
create unique index bookings_active_slot_idx on public.bookings (slot_id) where status <> 'canceled';
create index bookings_enrollment_idx on public.bookings (enrollment_id, status);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments (id) on delete cascade,
  amount int not null,
  covers_sessions int not null default 4,        -- 이 결제가 몇 회분인지
  note text,
  paid_at timestamptz not null default now()
);

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings (id) on delete set null,
  enrollment_id uuid not null references public.enrollments (id) on delete cascade,
  lesson_date date not null default current_date,
  progress text,                                 -- 진도
  notes text,                                    -- 비고
  homework text,                                 -- 과제
  created_at timestamptz not null default now()
);
create index journal_enrollment_idx on public.journal_entries (enrollment_id, lesson_date desc);

create table public.swap_requests (
  id uuid primary key default gen_random_uuid(),
  requester_booking_id uuid not null references public.bookings (id) on delete cascade,
  target_booking_id uuid not null references public.bookings (id) on delete cascade,
  message text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'canceled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create index swaps_target_idx on public.swap_requests (target_booking_id, status);
create index swaps_requester_idx on public.swap_requests (requester_booking_id, status);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  body text not null,
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notif_user_idx on public.notifications (user_id, read, created_at desc);

-- ---------- 헬퍼 ----------

create or replace function public.mask_name(t text)
returns text language sql immutable as $$
  select case
    when t is null or length(t) = 0 then '?'
    when length(t) = 1 then t || '*'
    when length(t) = 2 then left(t, 1) || '*'
    else left(t, 1) || repeat('*', length(t) - 2) || right(t, 1)
  end
$$;

create or replace function public.notify(p_user uuid, p_kind text, p_body text, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, kind, body, link)
  values (p_user, p_kind, p_body, p_link)
$$;

-- 학생-선생님 관계 확인 (RLS에서 사용)
create or replace function public.is_enrolled_with(p_teacher uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.enrollments
    where teacher_id = p_teacher and student_id = auth.uid() and status = 'active'
  )
$$;

create or replace function public.effective_cycle(p_enrollment uuid, out c_length int, out c_price int)
language sql stable security definer set search_path = public as $$
  select coalesce(e.cycle_length, ts.cycle_length),
         coalesce(e.cycle_price, ts.cycle_price)
  from public.enrollments e
  join public.teacher_settings ts on ts.teacher_id = e.teacher_id
  where e.id = p_enrollment
$$;

-- ---------- RLS ----------

alter table public.profiles enable row level security;
alter table public.teacher_settings enable row level security;
alter table public.enrollments enable row level security;
alter table public.slots enable row level security;
alter table public.bookings enable row level security;
alter table public.payments enable row level security;
alter table public.journal_entries enable row level security;
alter table public.swap_requests enable row level security;
alter table public.notifications enable row level security;

-- profiles: 본인 + 나와 연결된 상대(선생님↔학생)
create policy "profiles self insert" on public.profiles
  for insert with check (id = auth.uid());
create policy "profiles self update" on public.profiles
  for update using (id = auth.uid());
create policy "profiles read related" on public.profiles
  for select using (
    id = auth.uid()
    or exists (select 1 from public.enrollments e
               where (e.teacher_id = profiles.id and e.student_id = auth.uid())
                  or (e.student_id = profiles.id and e.teacher_id = auth.uid()))
  );

-- teacher_settings: 선생님 본인 전체 / 수강생은 읽기
create policy "settings teacher all" on public.teacher_settings
  for all using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());
create policy "settings student read" on public.teacher_settings
  for select using (public.is_enrolled_with(teacher_id));

-- enrollments: 양쪽 읽기, 선생님만 수정(메모 등)
create policy "enrollments read" on public.enrollments
  for select using (teacher_id = auth.uid() or student_id = auth.uid());
create policy "enrollments teacher update" on public.enrollments
  for update using (teacher_id = auth.uid());

-- slots: 선생님 CRUD(예약된 슬롯 삭제 금지), 수강생 읽기
create policy "slots teacher insert" on public.slots
  for insert with check (teacher_id = auth.uid());
create policy "slots teacher delete open only" on public.slots
  for delete using (teacher_id = auth.uid() and status = 'open');
create policy "slots read" on public.slots
  for select using (teacher_id = auth.uid() or public.is_enrolled_with(teacher_id));

-- bookings/swaps: 읽기만 직접 허용, 쓰기는 아래 함수로만
create policy "bookings read involved" on public.bookings
  for select using (
    exists (select 1 from public.enrollments e
            where e.id = bookings.enrollment_id
              and (e.teacher_id = auth.uid() or e.student_id = auth.uid()))
  );
create policy "payments read involved" on public.payments
  for select using (
    exists (select 1 from public.enrollments e
            where e.id = payments.enrollment_id
              and (e.teacher_id = auth.uid() or e.student_id = auth.uid()))
  );
create policy "payments teacher insert" on public.payments
  for insert with check (
    exists (select 1 from public.enrollments e
            where e.id = payments.enrollment_id and e.teacher_id = auth.uid())
  );

-- journal: 선생님 작성/수정, 학생 읽기
create policy "journal read involved" on public.journal_entries
  for select using (
    exists (select 1 from public.enrollments e
            where e.id = journal_entries.enrollment_id
              and (e.teacher_id = auth.uid() or e.student_id = auth.uid()))
  );
create policy "journal teacher write" on public.journal_entries
  for insert with check (
    exists (select 1 from public.enrollments e
            where e.id = journal_entries.enrollment_id and e.teacher_id = auth.uid())
  );
create policy "journal teacher update" on public.journal_entries
  for update using (
    exists (select 1 from public.enrollments e
            where e.id = journal_entries.enrollment_id and e.teacher_id = auth.uid())
  );

create policy "swaps read involved" on public.swap_requests
  for select using (
    exists (
      select 1 from public.bookings b
      join public.enrollments e on e.id = b.enrollment_id
      where (b.id = swap_requests.requester_booking_id or b.id = swap_requests.target_booking_id)
        and (e.student_id = auth.uid() or e.teacher_id = auth.uid())
    )
  );

create policy "notifications own" on public.notifications
  for select using (user_id = auth.uid());
create policy "notifications own update" on public.notifications
  for update using (user_id = auth.uid());

-- ---------- 핵심 함수 (security definer, 원자적 처리) ----------

-- 가입 코드로 선생님과 연결
create or replace function public.join_teacher(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_teacher uuid;
  v_enrollment uuid;
  v_student_name text;
begin
  select teacher_id into v_teacher from public.teacher_settings where join_code = upper(trim(p_code));
  if v_teacher is null then
    raise exception '가입 코드를 찾을 수 없어요';
  end if;

  insert into public.enrollments (teacher_id, student_id)
  values (v_teacher, auth.uid())
  on conflict (teacher_id, student_id) do update set status = 'active'
  returning id into v_enrollment;

  select name into v_student_name from public.profiles where id = auth.uid();
  perform public.notify(v_teacher, 'new_student',
    v_student_name || ' 님이 수강생으로 등록했어요', '/t/students');
  return v_enrollment;
end $$;

-- 슬롯 예약
create or replace function public.book_slot(p_slot uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_slot record;
  v_enrollment uuid;
  v_booking uuid;
  v_student_name text;
begin
  select * into v_slot from public.slots where id = p_slot for update;
  if v_slot is null then raise exception '슬롯을 찾을 수 없어요'; end if;
  if v_slot.status <> 'open' then raise exception '이미 예약된 시간이에요'; end if;
  if v_slot.starts_at <= now() then raise exception '지난 시간은 예약할 수 없어요'; end if;

  select id into v_enrollment from public.enrollments
  where teacher_id = v_slot.teacher_id and student_id = auth.uid() and status = 'active';
  if v_enrollment is null then raise exception '이 선생님의 수강생이 아니에요'; end if;

  insert into public.bookings (slot_id, enrollment_id) values (p_slot, v_enrollment)
  returning id into v_booking;
  update public.slots set status = 'booked' where id = p_slot;

  select name into v_student_name from public.profiles where id = auth.uid();
  perform public.notify(v_slot.teacher_id, 'booked',
    v_student_name || ' · ' || to_char(v_slot.starts_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI') || ' 예약',
    '/t/schedule');
  return v_booking;
end $$;

-- 예약 취소 (학생은 12시간 전까지, 선생님은 언제나) → 슬롯은 다시 open
create or replace function public.cancel_booking(p_booking uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v record;
  v_is_teacher boolean;
  v_actor_name text;
  v_other uuid;
begin
  select b.id, b.status, b.slot_id, b.enrollment_id, s.starts_at, s.teacher_id, e.student_id
    into v
  from public.bookings b
  join public.slots s on s.id = b.slot_id
  join public.enrollments e on e.id = b.enrollment_id
  where b.id = p_booking
  for update of b, s;

  if v is null then raise exception '예약을 찾을 수 없어요'; end if;
  if v.status <> 'confirmed' then raise exception '취소할 수 없는 상태예요'; end if;

  v_is_teacher := (auth.uid() = v.teacher_id);
  if not v_is_teacher and auth.uid() <> v.student_id then
    raise exception '권한이 없어요';
  end if;
  if not v_is_teacher and v.starts_at <= now() + interval '12 hours' then
    raise exception '수업 12시간 전까지만 취소할 수 있어요. 선생님께 직접 말씀해 주세요';
  end if;

  update public.bookings set status = 'canceled', canceled_at = now() where id = p_booking;
  update public.slots set status = 'open' where id = v.slot_id;
  update public.swap_requests set status = 'canceled', responded_at = now()
  where status = 'pending' and (requester_booking_id = p_booking or target_booking_id = p_booking);

  select name into v_actor_name from public.profiles where id = auth.uid();
  v_other := case when v_is_teacher then v.student_id else v.teacher_id end;
  perform public.notify(v_other, 'canceled',
    v_actor_name || ' 님이 ' || to_char(v.starts_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI') ||
    ' 수업을 취소했어요. 해당 시간은 다시 열렸어요',
    case when v_is_teacher then '/s/schedule' else '/t/schedule' end);
end $$;

-- 수업 완료 처리 → 회차 부여, 잔여 회차 계산 후 결제 알림
create or replace function public.complete_lesson(p_booking uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v record;
  v_next_no int;
  v_completed int;
  v_paid int;
  v_balance int;
  cyc record;
begin
  select b.id, b.status, b.enrollment_id, s.teacher_id, s.starts_at, e.student_id
    into v
  from public.bookings b
  join public.slots s on s.id = b.slot_id
  join public.enrollments e on e.id = b.enrollment_id
  where b.id = p_booking for update of b;

  if v is null then raise exception '예약을 찾을 수 없어요'; end if;
  if auth.uid() <> v.teacher_id then raise exception '선생님만 완료 처리할 수 있어요'; end if;
  if v.status <> 'confirmed' then raise exception '이미 처리된 예약이에요'; end if;

  select coalesce(max(session_no), 0) + 1 into v_next_no
  from public.bookings where enrollment_id = v.enrollment_id and status = 'completed';

  update public.bookings
  set status = 'completed', completed_at = now(), session_no = v_next_no
  where id = p_booking;

  select count(*)::int into v_completed from public.bookings
  where enrollment_id = v.enrollment_id and status = 'completed';
  select coalesce(sum(covers_sessions), 0)::int into v_paid from public.payments
  where enrollment_id = v.enrollment_id;
  v_balance := v_paid - v_completed;

  select * into cyc from public.effective_cycle(v.enrollment_id);

  if v_balance <= 0 then
    perform public.notify(v.student_id, 'payment_due',
      v_next_no || '회차 완료! 이번 사이클이 끝났어요 — 수강료 ' ||
      to_char(coalesce(cyc.c_price, 0), 'FM999,999,999') || '원 결제를 진행해 주세요',
      '/s/me');
  else
    perform public.notify(v.student_id, 'completed',
      v_next_no || '회차 수업 완료 · 결제분 ' || v_balance || '회 남았어요', '/s/me');
  end if;
end $$;

-- 입금 확인 (선생님)
create or replace function public.record_payment(p_enrollment uuid, p_amount int, p_covers int, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_teacher uuid;
  v_student uuid;
begin
  select teacher_id, student_id into v_teacher, v_student
  from public.enrollments where id = p_enrollment;
  if v_teacher is null or auth.uid() <> v_teacher then raise exception '권한이 없어요'; end if;
  if p_amount <= 0 or p_covers <= 0 then raise exception '금액과 회차 수를 확인해 주세요'; end if;

  insert into public.payments (enrollment_id, amount, covers_sessions, note)
  values (p_enrollment, p_amount, p_covers, p_note);

  perform public.notify(v_student, 'payment_confirmed',
    '수강료 ' || to_char(p_amount, 'FM999,999,999') || '원(' || p_covers || '회분) 입금이 확인됐어요', '/s/me');
end $$;

-- 스왑 요청 생성 (학생 → 다른 학생의 확정 예약)
create or replace function public.create_swap_request(p_my_booking uuid, p_target_booking uuid, p_message text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  mine record; target record; v_swap uuid; v_my_name text;
begin
  select b.id, b.status, b.enrollment_id, s.starts_at, s.teacher_id, e.student_id into mine
  from public.bookings b join public.slots s on s.id = b.slot_id
  join public.enrollments e on e.id = b.enrollment_id where b.id = p_my_booking;

  select b.id, b.status, b.enrollment_id, s.starts_at, s.teacher_id, e.student_id into target
  from public.bookings b join public.slots s on s.id = b.slot_id
  join public.enrollments e on e.id = b.enrollment_id where b.id = p_target_booking;

  if mine is null or target is null then raise exception '예약을 찾을 수 없어요'; end if;
  if mine.student_id <> auth.uid() then raise exception '내 예약이 아니에요'; end if;
  if mine.teacher_id <> target.teacher_id then raise exception '같은 선생님 수업끼리만 바꿀 수 있어요'; end if;
  if mine.enrollment_id = target.enrollment_id then raise exception '내 예약끼리는 바꿀 수 없어요'; end if;
  if mine.status <> 'confirmed' or target.status <> 'confirmed' then raise exception '확정된 예약끼리만 바꿀 수 있어요'; end if;
  if mine.starts_at <= now() or target.starts_at <= now() then raise exception '지난 수업은 바꿀 수 없어요'; end if;
  if exists (select 1 from public.swap_requests
             where requester_booking_id = p_my_booking and target_booking_id = p_target_booking
               and status = 'pending') then
    raise exception '이미 보낸 요청이 있어요';
  end if;

  insert into public.swap_requests (requester_booking_id, target_booking_id, message)
  values (p_my_booking, p_target_booking, p_message) returning id into v_swap;

  select name into v_my_name from public.profiles where id = auth.uid();
  perform public.notify(target.student_id, 'swap_request',
    public.mask_name(v_my_name) || ' 님이 ' ||
    to_char(target.starts_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI') || ' ↔ ' ||
    to_char(mine.starts_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI') || ' 시간 교환을 요청했어요',
    '/s/swaps');
  return v_swap;
end $$;

-- 스왑 응답 (수락 시 두 예약의 소유자를 원자적으로 교환)
create or replace function public.respond_swap(p_swap uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  sw record; rq record; tg record; v_teacher uuid;
begin
  select * into sw from public.swap_requests where id = p_swap for update;
  if sw is null then raise exception '요청을 찾을 수 없어요'; end if;
  if sw.status <> 'pending' then raise exception '이미 처리된 요청이에요'; end if;

  select b.id, b.status, b.enrollment_id, s.starts_at, s.teacher_id, e.student_id into rq
  from public.bookings b join public.slots s on s.id = b.slot_id
  join public.enrollments e on e.id = b.enrollment_id
  where b.id = sw.requester_booking_id for update of b;

  select b.id, b.status, b.enrollment_id, s.starts_at, s.teacher_id, e.student_id into tg
  from public.bookings b join public.slots s on s.id = b.slot_id
  join public.enrollments e on e.id = b.enrollment_id
  where b.id = sw.target_booking_id for update of b;

  if tg.student_id <> auth.uid() then raise exception '이 요청의 대상이 아니에요'; end if;

  if not p_accept then
    update public.swap_requests set status = 'declined', responded_at = now() where id = p_swap;
    perform public.notify(rq.student_id, 'swap_declined',
      to_char(tg.starts_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI') || ' 교환 요청이 거절됐어요', '/s/schedule');
    return;
  end if;

  if rq.status <> 'confirmed' or tg.status <> 'confirmed'
     or rq.starts_at <= now() or tg.starts_at <= now() then
    update public.swap_requests set status = 'canceled', responded_at = now() where id = p_swap;
    raise exception '예약 상태가 바뀌어 교환할 수 없어요';
  end if;

  -- 소유자 교환: 시간(슬롯)은 그대로, 예약의 주인만 서로 바꾼다
  update public.bookings set enrollment_id = tg.enrollment_id where id = rq.id;
  update public.bookings set enrollment_id = rq.enrollment_id where id = tg.id;
  update public.swap_requests set status = 'accepted', responded_at = now() where id = p_swap;

  -- 두 예약에 걸린 다른 대기 요청은 모두 취소
  update public.swap_requests set status = 'canceled', responded_at = now()
  where status = 'pending'
    and (requester_booking_id in (rq.id, tg.id) or target_booking_id in (rq.id, tg.id));

  v_teacher := rq.teacher_id;
  perform public.notify(rq.student_id, 'swap_accepted',
    '교환 성사! 내 수업이 ' || to_char(tg.starts_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI') || '로 변경됐어요', '/s/schedule');
  perform public.notify(v_teacher, 'swap_accepted',
    '학생 간 시간 교환: ' || to_char(rq.starts_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI') ||
    ' ↔ ' || to_char(tg.starts_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI'), '/t/schedule');
end $$;

-- 주간 스케줄 조회 (호출자에 따라 이름 마스킹)
create or replace function public.get_week_schedule(p_teacher uuid, p_from timestamptz, p_to timestamptz)
returns table (
  slot_id uuid, starts_at timestamptz, ends_at timestamptz, slot_status text,
  booking_id uuid, is_mine boolean, student_label text, enrollment_id uuid, session_done boolean
) language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() <> p_teacher and not public.is_enrolled_with(p_teacher) then
    raise exception '권한이 없어요';
  end if;
  return query
  select
    s.id, s.starts_at, s.ends_at, s.status,
    b.id,
    (e.student_id = auth.uid()),
    case
      when b.id is null then null
      when auth.uid() = p_teacher or e.student_id = auth.uid() then p.name
      else public.mask_name(p.name)
    end,
    case when auth.uid() = p_teacher or e.student_id = auth.uid() then e.id else null end,
    (b.status = 'completed')
  from public.slots s
  left join public.bookings b on b.slot_id = s.id and b.status <> 'canceled'
  left join public.enrollments e on e.id = b.enrollment_id
  left join public.profiles p on p.id = e.student_id
  where s.teacher_id = p_teacher and s.starts_at >= p_from and s.starts_at < p_to
  order by s.starts_at;
end $$;

-- 선생님용 학생 현황 요약
create or replace function public.get_students_overview()
returns table (
  enrollment_id uuid, student_id uuid, student_name text, phone text,
  started_at date, completed int, paid int, balance int,
  cycle_length int, cycle_price int, last_lesson date, teacher_memo text
) language sql stable security definer set search_path = public as $$
  select
    e.id, p.id, p.name, p.phone, e.started_at,
    coalesce(c.cnt, 0)::int,
    coalesce(pay.total, 0)::int,
    (coalesce(pay.total, 0) - coalesce(c.cnt, 0))::int,
    coalesce(e.cycle_length, ts.cycle_length),
    coalesce(e.cycle_price, ts.cycle_price),
    c.last_done, e.teacher_memo
  from public.enrollments e
  join public.profiles p on p.id = e.student_id
  join public.teacher_settings ts on ts.teacher_id = e.teacher_id
  left join lateral (
    select count(*) as cnt, max(completed_at)::date as last_done
    from public.bookings b where b.enrollment_id = e.id and b.status = 'completed'
  ) c on true
  left join lateral (
    select sum(covers_sessions) as total from public.payments where enrollment_id = e.id
  ) pay on true
  where e.teacher_id = auth.uid() and e.status = 'active'
  order by p.name
$$;

-- 학생 본인 회차·결제 요약
create or replace function public.get_my_summary(p_enrollment uuid)
returns table (completed int, paid int, balance int, cycle_length int, cycle_price int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.enrollments
                 where id = p_enrollment and (student_id = auth.uid() or teacher_id = auth.uid())) then
    raise exception '권한이 없어요';
  end if;
  return query
  select
    (select count(*)::int from public.bookings where enrollment_id = p_enrollment and status = 'completed'),
    (select coalesce(sum(covers_sessions), 0)::int from public.payments where enrollment_id = p_enrollment),
    (select coalesce(sum(covers_sessions), 0)::int from public.payments where enrollment_id = p_enrollment)
      - (select count(*)::int from public.bookings where enrollment_id = p_enrollment and status = 'completed'),
    c.c_length, c.c_price
  from public.effective_cycle(p_enrollment) c;
end $$;

-- 내 스왑 요청 목록 (받은/보낸, 상대 이름은 마스킹)
create or replace function public.get_my_swaps()
returns table (
  id uuid, direction text, status text, message text, created_at timestamptz,
  my_time timestamptz, other_time timestamptz, other_label text
) language sql stable security definer set search_path = public as $$
  select
    sw.id,
    case when te.student_id = auth.uid() then 'incoming' else 'outgoing' end,
    sw.status, sw.message, sw.created_at,
    case when te.student_id = auth.uid() then ts_.starts_at else rs.starts_at end,
    case when te.student_id = auth.uid() then rs.starts_at else ts_.starts_at end,
    case when te.student_id = auth.uid()
         then public.mask_name(rp.name) else public.mask_name(tp.name) end
  from public.swap_requests sw
  join public.bookings rb on rb.id = sw.requester_booking_id
  join public.slots rs on rs.id = rb.slot_id
  join public.enrollments re on re.id = rb.enrollment_id
  join public.profiles rp on rp.id = re.student_id
  join public.bookings tb on tb.id = sw.target_booking_id
  join public.slots ts_ on ts_.id = tb.slot_id
  join public.enrollments te on te.id = tb.enrollment_id
  join public.profiles tp on tp.id = te.student_id
  where re.student_id = auth.uid() or te.student_id = auth.uid()
  order by sw.created_at desc
  limit 50
$$;

-- 이번 주 슬롯 패턴을 다음 주로 복사 (겹치면 건너뜀)
create or replace function public.copy_week_slots(p_from timestamptz, p_to timestamptz)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'teacher') then
    raise exception '선생님만 사용할 수 있어요';
  end if;
  insert into public.slots (teacher_id, starts_at, ends_at, status)
  select teacher_id, starts_at + interval '7 days', ends_at + interval '7 days', 'open'
  from public.slots
  where teacher_id = auth.uid() and starts_at >= p_from and starts_at < p_to
  on conflict (teacher_id, starts_at) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
