-- =============================================================
-- 0012: 수강 연결 승인
--
--   학생이 가입 코드를 입력하면 바로 연결되지 않고 'pending'으로 신청됨.
--   선생님이 승인함(/t/requests)에서 승인/거절.
--   기존 화면들은 전부 status='active' 만 보므로, 승인 전에는
--   시간표·예약·반 배정 어디에도 나타나지 않는다.
-- =============================================================

alter table public.enrollments drop constraint if exists enrollments_status_check;
alter table public.enrollments add constraint enrollments_status_check
  check (status in ('pending', 'active', 'paused', 'ended', 'rejected'));

-- 가입 코드 입력 → 연결 신청 (반환: 'pending' | 'active'(이미 연결됨))
drop function if exists public.join_teacher(text);
create function public.join_teacher(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_teacher uuid;
  v_status text;
  v_student_name text;
begin
  select teacher_id into v_teacher from public.teacher_settings
  where join_code = upper(trim(p_code));
  if v_teacher is null then
    raise exception '가입 코드를 찾을 수 없어요';
  end if;

  select status into v_status from public.enrollments
  where teacher_id = v_teacher and student_id = auth.uid();

  if v_status = 'active' then return 'active'; end if;
  if v_status = 'pending' then return 'pending'; end if;

  insert into public.enrollments (teacher_id, student_id, status)
  values (v_teacher, auth.uid(), 'pending')
  on conflict (teacher_id, student_id)
    do update set status = 'pending', started_at = current_date;

  select name into v_student_name from public.profiles where id = auth.uid();
  perform public.notify(v_teacher, 'enroll_request',
    v_student_name || ' 님이 수강 연결을 신청했어요. 승인해 주세요', '/t/requests');
  return 'pending';
end $$;

-- 선생님의 승인/거절
create or replace function public.respond_enrollment(p_enrollment uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v record;
begin
  select e.id, e.status, e.student_id, e.teacher_id into v
  from public.enrollments e where e.id = p_enrollment for update;

  if v is null then raise exception '신청을 찾을 수 없어요'; end if;
  if auth.uid() <> v.teacher_id then raise exception '선생님만 처리할 수 있어요'; end if;
  if v.status <> 'pending' then raise exception '대기 중인 신청이 아니에요'; end if;

  if p_accept then
    update public.enrollments set status = 'active', started_at = current_date
    where id = p_enrollment;
    perform public.notify(v.student_id, 'enroll_accepted',
      '수강 연결이 승인됐어요! 이제 시간표에서 예약할 수 있어요', '/s/schedule');
  else
    update public.enrollments set status = 'rejected' where id = p_enrollment;
    perform public.notify(v.student_id, 'enroll_rejected',
      '수강 연결 신청이 거절됐어요', '/s/schedule');
  end if;
end $$;

-- 승인함에 수강 신청도 함께
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

revoke execute on all functions in schema public from anon, public;
