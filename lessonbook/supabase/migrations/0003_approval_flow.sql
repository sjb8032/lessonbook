-- =============================================================
-- 0003: 예약 / 취소 / 교환 승인 흐름
--
--   선생님 설정
--     - 학생의 취소, 학생끼리 교환을 허용할지 여부
--     - 교환 성사 시 내 승인을 받을지 여부
--     - 예약·취소의 "자유 기준 시간"
--
--   시간 규칙 (2단계)
--     수업까지 남은 시간 >  기준  → 즉시 처리
--     수업까지 남은 시간 <= 기준  → 선생님 승인 필요
-- =============================================================

-- ---------- 설정 ----------

alter table public.teacher_settings
  add column if not exists allow_student_cancel boolean not null default true,
  add column if not exists allow_student_swap   boolean not null default true,
  add column if not exists swap_needs_approval  boolean not null default true,
  add column if not exists cancel_free_hours    int     not null default 12,
  add column if not exists book_free_hours      int     not null default 12;

-- ---------- 상태 확장 ----------

-- pending: 선생님 승인 대기 중인 예약 신청 / rejected: 반려된 신청
alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings add constraint bookings_status_check
  check (status in ('pending', 'confirmed', 'completed', 'canceled', 'rejected'));

-- 확정 예약에 걸린 취소 요청은 예약 행 자체에 표시한다
alter table public.bookings
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists cancel_reason text;

-- 승인 대기 중인 신청도 슬롯을 점유한다 (다른 학생이 가로채지 못하게)
drop index if exists public.bookings_active_slot_idx;
create unique index bookings_active_slot_idx on public.bookings (slot_id)
  where status in ('pending', 'confirmed', 'completed');

-- awaiting_teacher: 상대 학생은 수락했고 선생님 승인만 남은 상태
alter table public.swap_requests drop constraint if exists swap_requests_status_check;
alter table public.swap_requests add constraint swap_requests_status_check
  check (status in ('pending', 'awaiting_teacher', 'accepted', 'declined', 'canceled'));

-- ---------- 예약 ----------

-- 기준시간 밖이면 바로 확정, 안쪽이면 'pending'으로 두고 선생님에게 알림
drop function if exists public.book_slot(uuid);
create function public.book_slot(p_slot uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_slot record;
  v_enrollment uuid;
  v_student_name text;
  v_free int;
  v_needs_approval boolean;
  v_when text;
begin
  select * into v_slot from public.slots where id = p_slot for update;
  if v_slot is null then raise exception '슬롯을 찾을 수 없어요'; end if;
  if v_slot.status <> 'open' then raise exception '이미 예약된 시간이에요'; end if;
  if v_slot.starts_at <= now() then raise exception '지난 시간은 예약할 수 없어요'; end if;

  select id into v_enrollment from public.enrollments
  where teacher_id = v_slot.teacher_id and student_id = auth.uid() and status = 'active';
  if v_enrollment is null then raise exception '이 선생님의 수강생이 아니에요'; end if;

  select book_free_hours into v_free
  from public.teacher_settings where teacher_id = v_slot.teacher_id;
  v_needs_approval := v_slot.starts_at <= now() + make_interval(hours => coalesce(v_free, 12));

  insert into public.bookings (slot_id, enrollment_id, status)
  values (p_slot, v_enrollment, case when v_needs_approval then 'pending' else 'confirmed' end);
  update public.slots set status = 'booked' where id = p_slot;

  select name into v_student_name from public.profiles where id = auth.uid();
  v_when := to_char(v_slot.starts_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI');

  if v_needs_approval then
    perform public.notify(v_slot.teacher_id, 'booking_request',
      v_student_name || ' · ' || v_when || ' 수업을 신청했어요. 승인해 주세요', '/t/requests');
    return 'pending';
  end if;

  perform public.notify(v_slot.teacher_id, 'booked',
    v_student_name || ' · ' || v_when || ' 예약', '/t/schedule');
  return 'confirmed';
end $$;

-- 선생님이 예약 신청을 승인/반려
create or replace function public.respond_booking(p_booking uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v record; v_when text;
begin
  select b.id, b.status, b.slot_id, s.starts_at, s.teacher_id, e.student_id into v
  from public.bookings b
  join public.slots s on s.id = b.slot_id
  join public.enrollments e on e.id = b.enrollment_id
  where b.id = p_booking
  for update of b, s;

  if v is null then raise exception '예약을 찾을 수 없어요'; end if;
  if auth.uid() <> v.teacher_id then raise exception '선생님만 처리할 수 있어요'; end if;
  if v.status <> 'pending' then raise exception '이미 처리된 신청이에요'; end if;

  v_when := to_char(v.starts_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI');

  if p_accept then
    update public.bookings set status = 'confirmed' where id = p_booking;
    perform public.notify(v.student_id, 'booking_accepted',
      v_when || ' 수업 예약이 확정됐어요', '/s/schedule');
  else
    update public.bookings set status = 'rejected' where id = p_booking;
    update public.slots set status = 'open' where id = v.slot_id;
    perform public.notify(v.student_id, 'booking_rejected',
      v_when || ' 수업 신청이 반려됐어요. 다른 시간을 골라 주세요', '/s/schedule');
  end if;
end $$;

-- ---------- 취소 ----------

-- 반환값: 'canceled'(즉시 취소됨) | 'requested'(선생님 승인 대기)
drop function if exists public.cancel_booking(uuid);
create function public.cancel_booking(p_booking uuid, p_reason text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v record;
  v_is_teacher boolean;
  v_actor_name text;
  v_other uuid;
  v_allow boolean;
  v_free int;
  v_when text;
begin
  select b.id, b.status, b.slot_id, b.cancel_requested_at,
         s.starts_at, s.teacher_id, e.student_id
    into v
  from public.bookings b
  join public.slots s on s.id = b.slot_id
  join public.enrollments e on e.id = b.enrollment_id
  where b.id = p_booking
  for update of b, s;

  if v is null then raise exception '예약을 찾을 수 없어요'; end if;
  if v.status not in ('pending', 'confirmed') then raise exception '취소할 수 없는 상태예요'; end if;

  v_is_teacher := (auth.uid() = v.teacher_id);
  if not v_is_teacher and auth.uid() <> v.student_id then
    raise exception '권한이 없어요';
  end if;

  select name into v_actor_name from public.profiles where id = auth.uid();
  v_when := to_char(v.starts_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI');

  -- 학생이 확정된 예약을 취소하려는 경우에만 정책을 적용한다.
  -- (아직 승인 전인 pending 신청은 본인이 언제든 거둬들일 수 있다)
  if not v_is_teacher and v.status = 'confirmed' then
    select allow_student_cancel, cancel_free_hours into v_allow, v_free
    from public.teacher_settings where teacher_id = v.teacher_id;

    if not coalesce(v_allow, true) then
      raise exception '선생님이 학생 취소를 막아두셨어요. 선생님께 직접 말씀해 주세요';
    end if;

    if v.starts_at <= now() + make_interval(hours => coalesce(v_free, 12)) then
      if v.cancel_requested_at is not null then
        raise exception '이미 취소를 요청했어요. 선생님 승인을 기다려 주세요';
      end if;
      update public.bookings
      set cancel_requested_at = now(), cancel_reason = p_reason
      where id = p_booking;

      perform public.notify(v.teacher_id, 'cancel_request',
        v_actor_name || ' · ' || v_when || ' 수업 취소를 요청했어요', '/t/requests');
      return 'requested';
    end if;
  end if;

  -- 즉시 취소
  update public.bookings
  set status = 'canceled', canceled_at = now(), cancel_requested_at = null
  where id = p_booking;
  update public.slots set status = 'open' where id = v.slot_id;
  update public.swap_requests set status = 'canceled', responded_at = now()
  where status in ('pending', 'awaiting_teacher')
    and (requester_booking_id = p_booking or target_booking_id = p_booking);

  v_other := case when v_is_teacher then v.student_id else v.teacher_id end;
  perform public.notify(v_other, 'canceled',
    v_actor_name || ' 님이 ' || v_when || ' 수업을 취소했어요. 해당 시간은 다시 열렸어요',
    case when v_is_teacher then '/s/schedule' else '/t/schedule' end);
  return 'canceled';
end $$;

-- 선생님이 취소 요청을 승인/반려
create or replace function public.respond_cancel(p_booking uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v record; v_when text;
begin
  select b.id, b.status, b.slot_id, b.cancel_requested_at,
         s.starts_at, s.teacher_id, e.student_id
    into v
  from public.bookings b
  join public.slots s on s.id = b.slot_id
  join public.enrollments e on e.id = b.enrollment_id
  where b.id = p_booking
  for update of b, s;

  if v is null then raise exception '예약을 찾을 수 없어요'; end if;
  if auth.uid() <> v.teacher_id then raise exception '선생님만 처리할 수 있어요'; end if;
  if v.cancel_requested_at is null or v.status <> 'confirmed' then
    raise exception '대기 중인 취소 요청이 아니에요';
  end if;

  v_when := to_char(v.starts_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI');

  if p_accept then
    update public.bookings
    set status = 'canceled', canceled_at = now(), cancel_requested_at = null
    where id = p_booking;
    update public.slots set status = 'open' where id = v.slot_id;
    update public.swap_requests set status = 'canceled', responded_at = now()
    where status in ('pending', 'awaiting_teacher')
      and (requester_booking_id = p_booking or target_booking_id = p_booking);

    perform public.notify(v.student_id, 'cancel_accepted',
      v_when || ' 수업 취소가 승인됐어요', '/s/schedule');
  else
    update public.bookings set cancel_requested_at = null, cancel_reason = null
    where id = p_booking;
    perform public.notify(v.student_id, 'cancel_rejected',
      v_when || ' 수업 취소 요청이 반려됐어요. 수업은 그대로예요', '/s/schedule');
  end if;
end $$;

-- ---------- 교환 ----------

-- 두 예약의 주인을 맞바꾸는 실제 처리 (내부 전용)
create or replace function public._exec_swap(p_swap uuid)
returns void language plpgsql security definer set search_path = public as $$
declare sw record; rq record; tg record; v_rq_when text; v_tg_when text;
begin
  select * into sw from public.swap_requests where id = p_swap for update;

  select b.id, b.status, b.enrollment_id, s.starts_at, s.teacher_id, e.student_id into rq
  from public.bookings b
  join public.slots s on s.id = b.slot_id
  join public.enrollments e on e.id = b.enrollment_id
  where b.id = sw.requester_booking_id for update of b;

  select b.id, b.status, b.enrollment_id, s.starts_at, s.teacher_id, e.student_id into tg
  from public.bookings b
  join public.slots s on s.id = b.slot_id
  join public.enrollments e on e.id = b.enrollment_id
  where b.id = sw.target_booking_id for update of b;

  if rq.status <> 'confirmed' or tg.status <> 'confirmed'
     or rq.starts_at <= now() or tg.starts_at <= now() then
    update public.swap_requests set status = 'canceled', responded_at = now() where id = p_swap;
    raise exception '예약 상태가 바뀌어 교환할 수 없어요';
  end if;

  -- 시간(슬롯)은 그대로, 예약의 주인만 서로 바꾼다
  update public.bookings set enrollment_id = tg.enrollment_id where id = rq.id;
  update public.bookings set enrollment_id = rq.enrollment_id where id = tg.id;
  update public.swap_requests set status = 'accepted', responded_at = now() where id = p_swap;

  -- 두 예약에 걸린 다른 대기 요청은 모두 무효화
  update public.swap_requests set status = 'canceled', responded_at = now()
  where status in ('pending', 'awaiting_teacher') and id <> p_swap
    and (requester_booking_id in (rq.id, tg.id) or target_booking_id in (rq.id, tg.id));

  v_rq_when := to_char(rq.starts_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI');
  v_tg_when := to_char(tg.starts_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI');

  perform public.notify(rq.student_id, 'swap_accepted',
    '교환 성사! 내 수업이 ' || v_tg_when || '로 변경됐어요', '/s/schedule');
  perform public.notify(tg.student_id, 'swap_accepted',
    '교환 성사! 내 수업이 ' || v_rq_when || '로 변경됐어요', '/s/schedule');
  perform public.notify(rq.teacher_id, 'swap_accepted',
    '학생 간 시간 교환: ' || v_rq_when || ' ↔ ' || v_tg_when, '/t/schedule');
end $$;

-- 교환 요청 생성 — 선생님이 교환을 막아뒀으면 거절
create or replace function public.create_swap_request(p_my_booking uuid, p_target_booking uuid, p_message text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  mine record; target record; v_swap uuid; v_my_name text; v_allow boolean;
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

  select allow_student_swap into v_allow
  from public.teacher_settings where teacher_id = mine.teacher_id;
  if not coalesce(v_allow, true) then
    raise exception '선생님이 학생끼리의 시간 교환을 막아두셨어요';
  end if;

  if exists (select 1 from public.swap_requests
             where requester_booking_id = p_my_booking and target_booking_id = p_target_booking
               and status in ('pending', 'awaiting_teacher')) then
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

-- 상대 학생의 응답. 반환값: 'declined' | 'awaiting_teacher' | 'accepted'
drop function if exists public.respond_swap(uuid, boolean);
create function public.respond_swap(p_swap uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare
  sw record; rq record; tg record; v_needs boolean; v_rq_when text; v_tg_when text;
begin
  select * into sw from public.swap_requests where id = p_swap for update;
  if sw is null then raise exception '요청을 찾을 수 없어요'; end if;
  if sw.status <> 'pending' then raise exception '이미 처리된 요청이에요'; end if;

  select b.id, b.status, s.starts_at, s.teacher_id, e.student_id into rq
  from public.bookings b join public.slots s on s.id = b.slot_id
  join public.enrollments e on e.id = b.enrollment_id where b.id = sw.requester_booking_id;

  select b.id, b.status, s.starts_at, s.teacher_id, e.student_id into tg
  from public.bookings b join public.slots s on s.id = b.slot_id
  join public.enrollments e on e.id = b.enrollment_id where b.id = sw.target_booking_id;

  if tg.student_id <> auth.uid() then raise exception '이 요청의 대상이 아니에요'; end if;

  v_rq_when := to_char(rq.starts_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI');
  v_tg_when := to_char(tg.starts_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI');

  if not p_accept then
    update public.swap_requests set status = 'declined', responded_at = now() where id = p_swap;
    perform public.notify(rq.student_id, 'swap_declined',
      v_tg_when || ' 교환 요청이 거절됐어요', '/s/schedule');
    return 'declined';
  end if;

  select swap_needs_approval into v_needs
  from public.teacher_settings where teacher_id = tg.teacher_id;

  if coalesce(v_needs, true) then
    update public.swap_requests set status = 'awaiting_teacher' where id = p_swap;
    perform public.notify(tg.teacher_id, 'swap_awaiting',
      '학생끼리 시간 교환에 합의했어요. 승인해 주세요: ' || v_rq_when || ' ↔ ' || v_tg_when,
      '/t/requests');
    perform public.notify(rq.student_id, 'swap_awaiting',
      '상대가 수락했어요. 선생님 승인을 기다리는 중이에요', '/s/swaps');
    return 'awaiting_teacher';
  end if;

  perform public._exec_swap(p_swap);
  return 'accepted';
end $$;

-- 선생님의 최종 승인/반려
create or replace function public.respond_swap_teacher(p_swap uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare sw record; rq record; tg record;
begin
  select * into sw from public.swap_requests where id = p_swap for update;
  if sw is null then raise exception '요청을 찾을 수 없어요'; end if;
  if sw.status <> 'awaiting_teacher' then raise exception '승인 대기 중인 교환이 아니에요'; end if;

  select s.teacher_id, e.student_id, s.starts_at into rq
  from public.bookings b join public.slots s on s.id = b.slot_id
  join public.enrollments e on e.id = b.enrollment_id where b.id = sw.requester_booking_id;

  select e.student_id, s.starts_at into tg
  from public.bookings b join public.slots s on s.id = b.slot_id
  join public.enrollments e on e.id = b.enrollment_id where b.id = sw.target_booking_id;

  if auth.uid() <> rq.teacher_id then raise exception '선생님만 처리할 수 있어요'; end if;

  if p_accept then
    perform public._exec_swap(p_swap);
    return;
  end if;

  update public.swap_requests set status = 'declined', responded_at = now() where id = p_swap;
  perform public.notify(rq.student_id, 'swap_declined',
    '선생님이 시간 교환을 승인하지 않으셨어요. 수업은 그대로예요', '/s/schedule');
  perform public.notify(tg.student_id, 'swap_declined',
    '선생님이 시간 교환을 승인하지 않으셨어요. 수업은 그대로예요', '/s/schedule');
end $$;

-- ---------- 조회 ----------

-- 주간 스케줄에 예약 상태와 취소요청 여부를 함께 내려준다
drop function if exists public.get_week_schedule(uuid, timestamptz, timestamptz);
create function public.get_week_schedule(p_teacher uuid, p_from timestamptz, p_to timestamptz)
returns table (
  slot_id uuid, starts_at timestamptz, ends_at timestamptz, slot_status text,
  booking_id uuid, is_mine boolean, student_label text, enrollment_id uuid,
  session_done boolean, booking_status text, cancel_requested boolean
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
    (b.cancel_requested_at is not null)
  from public.slots s
  left join public.bookings b
    on b.slot_id = s.id and b.status in ('pending', 'confirmed', 'completed')
  left join public.enrollments e on e.id = b.enrollment_id
  left join public.profiles p on p.id = e.student_id
  where s.teacher_id = p_teacher and s.starts_at >= p_from and s.starts_at < p_to
  order by s.starts_at;
end $$;

-- 선생님 승인 대기함 (예약 신청 / 취소 요청 / 교환 승인)
create or replace function public.get_teacher_requests()
returns table (
  kind text, ref_id uuid, starts_at timestamptz, other_time timestamptz,
  who text, message text, created_at timestamptz
) language sql stable security definer set search_path = public as $$
  select 'booking', b.id, s.starts_at, null::timestamptz, p.name, null::text, b.created_at
  from public.bookings b
  join public.slots s on s.id = b.slot_id
  join public.enrollments e on e.id = b.enrollment_id
  join public.profiles p on p.id = e.student_id
  where s.teacher_id = auth.uid() and b.status = 'pending'

  union all

  select 'cancel', b.id, s.starts_at, null::timestamptz, p.name, b.cancel_reason, b.cancel_requested_at
  from public.bookings b
  join public.slots s on s.id = b.slot_id
  join public.enrollments e on e.id = b.enrollment_id
  join public.profiles p on p.id = e.student_id
  where s.teacher_id = auth.uid()
    and b.status = 'confirmed' and b.cancel_requested_at is not null

  union all

  select 'swap', sw.id, rs.starts_at, ts_.starts_at,
         rp.name || ' ↔ ' || tp.name, sw.message, sw.created_at
  from public.swap_requests sw
  join public.bookings rb on rb.id = sw.requester_booking_id
  join public.slots rs on rs.id = rb.slot_id
  join public.enrollments re on re.id = rb.enrollment_id
  join public.profiles rp on rp.id = re.student_id
  join public.bookings tb on tb.id = sw.target_booking_id
  join public.slots ts_ on ts_.id = tb.slot_id
  join public.enrollments te on te.id = tb.enrollment_id
  join public.profiles tp on tp.id = te.student_id
  where sw.status = 'awaiting_teacher' and rs.teacher_id = auth.uid()

  order by 3
$$;

-- ---------- 권한 ----------

revoke execute on all functions in schema public from anon, public;
revoke execute on function public._exec_swap(uuid) from authenticated;
