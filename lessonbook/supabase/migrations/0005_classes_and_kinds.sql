-- =============================================================
-- 0005: 반(수준) + 예약 종류(수업/녹음/체험)  — 1단계 뼈대
--
--   반(class): 선생님이 만드는 그룹. 이름·설명(가격은 2단계). 학생은 여러 반에 동시 소속.
--   예약 종류: slots/bookings.kind = lesson | recording | trial
--     - lesson   : 반에 소속된 학생만. 슬롯에 class_id 지정 시 그 반만.
--     - recording: 연결된 사람 누구나(반 없어도). 회차 누적 없음.
--     - trial    : 체험 (세부 설정은 3단계). 회차 누적 없음.
--   회차는 lesson 에서만, "학생×반" 단위로 쌓인다.
-- =============================================================

-- ---------- 테이블 ----------

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  description text,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index classes_teacher_idx on public.classes (teacher_id, archived);

-- 학생(enrollment) ↔ 반  다대다
create table public.class_members (
  class_id uuid not null references public.classes (id) on delete cascade,
  enrollment_id uuid not null references public.enrollments (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (class_id, enrollment_id)
);
create index class_members_enrollment_idx on public.class_members (enrollment_id);

-- ---------- 슬롯 / 예약에 종류·반 ----------

alter table public.slots
  add column if not exists kind text not null default 'lesson'
    check (kind in ('lesson', 'recording', 'trial')),
  add column if not exists class_id uuid references public.classes (id) on delete set null;

alter table public.bookings
  add column if not exists kind text not null default 'lesson'
    check (kind in ('lesson', 'recording', 'trial')),
  add column if not exists class_id uuid references public.classes (id) on delete set null;

-- ---------- RLS ----------

alter table public.classes enable row level security;
alter table public.class_members enable row level security;

-- 반: 선생님 CRUD, 수강생은 읽기
create policy "classes teacher all" on public.classes
  for all using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());
create policy "classes student read" on public.classes
  for select using (public.is_enrolled_with(teacher_id));

-- 반 멤버십: 선생님이 자기 반+자기 학생끼리만 연결, 학생은 자기 것 읽기
create policy "class_members teacher manage" on public.class_members
  for all using (
    exists (select 1 from public.classes c
            where c.id = class_members.class_id and c.teacher_id = auth.uid())
  ) with check (
    exists (
      select 1 from public.classes c
      join public.enrollments e on e.teacher_id = c.teacher_id
      where c.id = class_members.class_id
        and c.teacher_id = auth.uid()
        and e.id = class_members.enrollment_id
    )
  );
create policy "class_members student read" on public.class_members
  for select using (
    exists (select 1 from public.enrollments e
            where e.id = class_members.enrollment_id and e.student_id = auth.uid())
  );

-- 슬롯 insert: class_id 를 쓸 거면 그 반이 내 반이어야 함
drop policy if exists "slots teacher insert" on public.slots;
create policy "slots teacher insert" on public.slots
  for insert with check (
    teacher_id = auth.uid()
    and (
      class_id is null
      or exists (select 1 from public.classes c
                 where c.id = slots.class_id and c.teacher_id = auth.uid())
    )
  );

-- ---------- 헬퍼: 예약 자격 판단 ----------

-- 이 사람이 이 슬롯을 예약할 수 있나 + lesson이면 어느 반으로 잡을지
create or replace function public.resolve_booking_class(
  p_slot public.slots, p_enrollment uuid, p_class uuid
) returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_classes uuid[];
begin
  if p_slot.kind <> 'lesson' then
    return null;  -- 녹음/체험은 반 없음
  end if;

  if p_slot.class_id is not null then
    -- 반 전용 슬롯: 그 반 멤버만
    if not exists (select 1 from public.class_members
                   where class_id = p_slot.class_id and enrollment_id = p_enrollment) then
      raise exception '이 시간은 해당 반 수강생만 예약할 수 있어요';
    end if;
    return p_slot.class_id;
  end if;

  -- 제한 없는 수업 슬롯: 내가 속한 반으로 잡는다
  if p_class is not null then
    if not exists (select 1 from public.class_members
                   where class_id = p_class and enrollment_id = p_enrollment) then
      raise exception '그 반의 수강생이 아니에요';
    end if;
    return p_class;
  end if;

  select array_agg(class_id) into v_classes
  from public.class_members where enrollment_id = p_enrollment;
  if v_classes is null then raise exception '먼저 반에 등록되어야 수업을 예약할 수 있어요'; end if;
  if array_length(v_classes, 1) > 1 then raise exception '어느 반 수업인지 선택해 주세요'; end if;
  return v_classes[1];
end $$;

-- ---------- 예약 (종류·반 반영) ----------

drop function if exists public.book_slot(uuid);
drop function if exists public.book_slot(uuid, uuid);
create function public.book_slot(p_slot uuid, p_class uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_slot public.slots;
  v_enrollment uuid;
  v_class uuid;
  v_student_name text;
  v_free int;
  v_needs_approval boolean;
  v_when text;
  v_kind_label text;
begin
  select * into v_slot from public.slots where id = p_slot for update;
  if v_slot is null then raise exception '슬롯을 찾을 수 없어요'; end if;
  if v_slot.status <> 'open' then raise exception '이미 예약된 시간이에요'; end if;
  if v_slot.starts_at <= now() then raise exception '지난 시간은 예약할 수 없어요'; end if;

  select id into v_enrollment from public.enrollments
  where teacher_id = v_slot.teacher_id and student_id = auth.uid() and status = 'active';
  if v_enrollment is null then raise exception '이 선생님과 연결되어 있지 않아요'; end if;

  v_class := public.resolve_booking_class(v_slot, v_enrollment, p_class);

  select book_free_hours into v_free
  from public.teacher_settings where teacher_id = v_slot.teacher_id;
  v_needs_approval := v_slot.starts_at <= now() + make_interval(hours => coalesce(v_free, 12));

  insert into public.bookings (slot_id, enrollment_id, status, kind, class_id)
  values (p_slot, v_enrollment,
          case when v_needs_approval then 'pending' else 'confirmed' end,
          v_slot.kind, v_class);
  update public.slots set status = 'booked' where id = p_slot;

  select name into v_student_name from public.profiles where id = auth.uid();
  v_when := to_char(v_slot.starts_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI');
  v_kind_label := case v_slot.kind when 'recording' then '녹음'
                                   when 'trial' then '체험' else '수업' end;

  if v_needs_approval then
    perform public.notify(v_slot.teacher_id, 'booking_request',
      v_student_name || ' · ' || v_when || ' ' || v_kind_label || '을 신청했어요. 승인해 주세요',
      '/t/requests');
    return 'pending';
  end if;

  perform public.notify(v_slot.teacher_id, 'booked',
    v_student_name || ' · ' || v_when || ' ' || v_kind_label || ' 예약', '/t/schedule');
  return 'confirmed';
end $$;

-- 완료 처리: 회차는 lesson 에서만 "학생×반" 단위로 쌓임
drop function if exists public.complete_lesson(uuid);
create function public.complete_lesson(p_booking uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v record; v_next_no int; v_completed int; v_paid int; v_balance int; cyc record;
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

  -- 녹음/체험은 회차·결제 없이 완료만
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

  -- 잔여 회차 알림 (2단계에서 반별 가격으로 정교화 예정)
  select count(*)::int into v_completed from public.bookings
  where enrollment_id = v.enrollment_id and class_id is not distinct from v.class_id
    and status = 'completed';
  select coalesce(sum(covers_sessions), 0)::int into v_paid from public.payments
  where enrollment_id = v.enrollment_id;
  v_balance := v_paid - v_completed;

  select * into cyc from public.effective_cycle(v.enrollment_id);
  if v_balance <= 0 then
    perform public.notify(v.student_id, 'payment_due',
      v_next_no || '회차 완료! 수강료 결제를 진행해 주세요', '/s/me');
  else
    perform public.notify(v.student_id, 'completed',
      v_next_no || '회차 수업 완료 · 결제분 ' || v_balance || '회 남았어요', '/s/me');
  end if;
end $$;

-- ---------- 조회: 시간표에 종류·반 이름 ----------

drop function if exists public.get_week_schedule(uuid, timestamptz, timestamptz);
create function public.get_week_schedule(p_teacher uuid, p_from timestamptz, p_to timestamptz)
returns table (
  slot_id uuid, starts_at timestamptz, ends_at timestamptz, slot_status text,
  booking_id uuid, is_mine boolean, student_label text, enrollment_id uuid,
  session_done boolean, booking_status text, cancel_requested boolean,
  kind text, class_id uuid, class_name text
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
    (b.status = 'completed'),
    b.status,
    (b.cancel_requested_at is not null),
    s.kind,
    s.class_id,
    c.name
  from public.slots s
  left join public.bookings b
    on b.slot_id = s.id and b.status in ('pending', 'confirmed', 'completed')
  left join public.enrollments e on e.id = b.enrollment_id
  left join public.profiles p on p.id = e.student_id
  left join public.classes c on c.id = s.class_id
  where s.teacher_id = p_teacher and s.starts_at >= p_from and s.starts_at < p_to
  order by s.starts_at;
end $$;

-- 선생님용 반 목록 (소속 학생 수 포함)
create or replace function public.get_classes()
returns table (id uuid, name text, description text, archived boolean, member_count int)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.description, c.archived,
         (select count(*)::int from public.class_members m where m.class_id = c.id)
  from public.classes c
  where c.teacher_id = auth.uid()
  order by c.archived, c.created_at;
$$;

-- 한 반의 소속 학생 + 선생님의 전체 학생(멤버 여부 플래그)
create or replace function public.get_class_roster(p_class uuid)
returns table (enrollment_id uuid, student_name text, is_member boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.classes where id = p_class and teacher_id = auth.uid()) then
    raise exception '권한이 없어요';
  end if;
  return query
  select e.id, p.name,
         exists (select 1 from public.class_members m
                 where m.class_id = p_class and m.enrollment_id = e.id)
  from public.enrollments e
  join public.profiles p on p.id = e.student_id
  where e.teacher_id = auth.uid() and e.status = 'active'
  order by p.name;
end $$;

-- 학생이 자기가 속한 반 목록 (예약 시 반 선택용)
create or replace function public.get_my_classes(p_teacher uuid)
returns table (class_id uuid, name text)
language sql stable security definer set search_path = public as $$
  select c.id, c.name
  from public.class_members m
  join public.classes c on c.id = m.class_id
  join public.enrollments e on e.id = m.enrollment_id
  where e.student_id = auth.uid() and c.teacher_id = p_teacher and c.archived = false
  order by c.name;
$$;

-- ---------- 권한 ----------

revoke execute on all functions in schema public from anon, public;
revoke execute on function public.resolve_booking_class(public.slots, uuid, uuid) from authenticated;
