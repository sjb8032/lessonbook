-- =============================================================
-- 0010: 체험 설정 — 3단계
--
--   선생님이 설정:
--     allow_trial : 체험을 받을지
--     trial_limit : 한 학생이 신청할 수 있는 체험 횟수 (기본 1)
--     trial_price : 체험비(원, 0 = 무료) — 안내용 표시
--   book_slot 에서 체험 슬롯 예약 시 위 규칙을 검사한다.
-- =============================================================

alter table public.teacher_settings
  add column if not exists allow_trial boolean not null default true,
  add column if not exists trial_limit int not null default 1 check (trial_limit >= 1),
  add column if not exists trial_price int not null default 0 check (trial_price >= 0);

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
  v_allow_trial boolean;
  v_trial_limit int;
  v_trials int;
begin
  select * into v_slot from public.slots where id = p_slot for update;
  if v_slot is null then raise exception '슬롯을 찾을 수 없어요'; end if;
  if v_slot.status <> 'open' then raise exception '이미 예약된 시간이에요'; end if;
  if v_slot.starts_at <= now() then raise exception '지난 시간은 예약할 수 없어요'; end if;

  select id into v_enrollment from public.enrollments
  where teacher_id = v_slot.teacher_id and student_id = auth.uid() and status = 'active';
  if v_enrollment is null then raise exception '이 선생님과 연결되어 있지 않아요'; end if;

  -- 체험 규칙
  if v_slot.kind = 'trial' then
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

revoke execute on all functions in schema public from anon, public;
