-- =============================================================
-- 0014: 시간 열기에서 종류 구분 제거
--
--   선생님은 그냥 "되는 시간"만 연다 (반 전용 제한은 유지).
--   수업/녹음/체험은 학생이 예약할 때 고른다 → bookings.kind 에 기록.
--   slots.kind 는 더 이상 읽지 않는다 (컬럼은 과거 데이터용으로 유지).
--   반 전용 슬롯은 그 반 수업으로만 예약할 수 있다.
-- =============================================================

-- 자격 판단: 슬롯 종류가 아니라 "예약하려는 종류" 기준으로
drop function if exists public.resolve_booking_class(public.slots, uuid, uuid);
create function public.resolve_booking_class(
  p_slot public.slots, p_enrollment uuid, p_class uuid, p_kind text
) returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_classes uuid[];
begin
  if p_kind <> 'lesson' then
    if p_slot.class_id is not null then
      raise exception '이 시간은 반 수업 전용이에요';
    end if;
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

  -- 제한 없는 슬롯: 내가 속한 반으로 잡는다
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

-- 예약: 종류를 학생이 고른다
drop function if exists public.book_slot(uuid, uuid);
create function public.book_slot(p_slot uuid, p_class uuid default null, p_kind text default 'lesson')
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
  v_allow_trial boolean;
  v_trial_limit int;
  v_trials int;
begin
  if p_kind not in ('lesson', 'recording', 'trial') then
    raise exception '알 수 없는 예약 종류예요';
  end if;

  select * into v_slot from public.slots where id = p_slot for update;
  if v_slot is null then raise exception '슬롯을 찾을 수 없어요'; end if;
  if v_slot.status <> 'open' then raise exception '이미 예약된 시간이에요'; end if;
  if v_slot.starts_at <= now() then raise exception '지난 시간은 예약할 수 없어요'; end if;

  select id into v_enrollment from public.enrollments
  where teacher_id = v_slot.teacher_id and student_id = auth.uid() and status = 'active';
  if v_enrollment is null then raise exception '이 선생님과 연결되어 있지 않아요'; end if;

  -- 체험 규칙
  if p_kind = 'trial' then
    select allow_trial, trial_limit into v_allow_trial, v_trial_limit
    from public.teacher_settings where teacher_id = v_slot.teacher_id;

    if not coalesce(v_allow_trial, true) then
      raise exception '지금은 체험을 받지 않고 있어요';
    end if;

    select count(*)::int into v_trials from public.bookings b
    where b.enrollment_id = v_enrollment and b.kind = 'trial'
      and b.status in ('pending', 'confirmed', 'completed');
    if v_trials >= coalesce(v_trial_limit, 1) then
      raise exception '체험은 %회까지만 신청할 수 있어요', coalesce(v_trial_limit, 1);
    end if;
  end if;

  v_class := public.resolve_booking_class(v_slot, v_enrollment, p_class, p_kind);

  select book_free_hours into v_free
  from public.teacher_settings where teacher_id = v_slot.teacher_id;
  v_needs_approval := v_slot.starts_at <= now() + make_interval(hours => coalesce(v_free, 12));

  insert into public.bookings (slot_id, enrollment_id, status, kind, class_id)
  values (p_slot, v_enrollment,
          case when v_needs_approval then 'pending' else 'confirmed' end,
          p_kind, v_class);
  update public.slots set status = 'booked' where id = p_slot;

  select name into v_student_name from public.profiles where id = auth.uid();
  v_when := to_char(v_slot.starts_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI');
  v_kind_label := case p_kind when 'recording' then '녹음'
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

-- 시간표: 종류는 예약에서, 반 이름은 예약된 반(없으면 슬롯 제한)에서
create or replace function public.get_week_schedule(p_teacher uuid, p_from timestamptz, p_to timestamptz)
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
    coalesce(b.kind, 'lesson'),
    coalesce(b.class_id, s.class_id),
    c.name
  from public.slots s
  left join public.bookings b
    on b.slot_id = s.id and b.status in ('pending', 'confirmed', 'completed')
  left join public.enrollments e on e.id = b.enrollment_id
  left join public.profiles p on p.id = e.student_id
  left join public.classes c on c.id = coalesce(b.class_id, s.class_id)
  where s.teacher_id = p_teacher and s.starts_at >= p_from and s.starts_at < p_to
  order by s.starts_at;
end $$;

-- 승인함: 예약 신청에 종류(녹음/체험) 또는 반 이름을 함께 표시
create or replace function public.get_teacher_requests()
returns table (
  kind text, ref_id uuid, starts_at timestamptz, other_time timestamptz,
  who text, message text, created_at timestamptz
) language sql stable security definer set search_path = public as $$
  select 'enrollment', e.id, e.started_at::timestamptz, null::timestamptz,
         p.name, p.phone, e.started_at::timestamptz
  from public.enrollments e
  join public.profiles p on p.id = e.student_id
  where e.teacher_id = auth.uid() and e.status = 'pending'

  union all

  select 'booking', b.id, s.starts_at, null::timestamptz, p.name,
         case b.kind when 'recording' then '녹음'
                     when 'trial' then '체험'
                     else c.name end,
         b.created_at
  from public.bookings b
  join public.slots s on s.id = b.slot_id
  join public.enrollments e on e.id = b.enrollment_id
  join public.profiles p on p.id = e.student_id
  left join public.classes c on c.id = b.class_id
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

-- 주 복사: 반 전용 제한도 함께 복사
create or replace function public.copy_week_slots(p_from timestamptz, p_to timestamptz)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'teacher') then
    raise exception '선생님만 사용할 수 있어요';
  end if;
  insert into public.slots (teacher_id, starts_at, ends_at, status, class_id)
  select teacher_id, starts_at + interval '7 days', ends_at + interval '7 days', 'open', class_id
  from public.slots
  where teacher_id = auth.uid() and starts_at >= p_from and starts_at < p_to
  on conflict (teacher_id, starts_at) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on all functions in schema public from anon, public;
revoke execute on function public.resolve_booking_class(public.slots, uuid, uuid, text) from authenticated;
