-- =============================================================
-- 0004: 교환에도 "자유 기준 시간"을 준다
--
--   지금까지 교환은 swap_needs_approval 하나로만 갈렸다(켜져 있으면 항상 승인).
--   예약·취소와 마찬가지로, 수업이 충분히 남았으면 학생끼리 합의만으로 끝나고
--   기준 안쪽일 때만 선생님 승인을 받도록 바꾼다.
--
--   승인이 필요한 조건:
--     swap_needs_approval 이 켜져 있거나 (시간 무관 항상 승인)
--     두 수업 중 더 임박한 쪽이 swap_free_hours 안쪽일 때
-- =============================================================

alter table public.teacher_settings
  add column if not exists swap_free_hours int not null default 12;

-- swap_needs_approval 의 뜻이 바뀐다:
--   (이전) 켜짐 = 교환 시 선생님 승인을 거친다
--   (이후) 켜짐 = 시간과 무관하게 항상 승인을 거친다  ← 시간 규칙을 무시하는 덮어쓰기
-- 0003에서 true로 채워둔 값을 그대로 두면 시간 기준이 영영 동작하지 않으므로 false로 내린다.
alter table public.teacher_settings alter column swap_needs_approval set default false;
update public.teacher_settings set swap_needs_approval = false;

drop function if exists public.respond_swap(uuid, boolean);
create function public.respond_swap(p_swap uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare
  sw record; rq record; tg record;
  v_always boolean; v_free int; v_needs boolean;
  v_rq_when text; v_tg_when text;
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

  select swap_needs_approval, swap_free_hours into v_always, v_free
  from public.teacher_settings where teacher_id = tg.teacher_id;

  -- 두 수업 중 더 임박한 쪽을 기준으로 판단한다
  v_needs := coalesce(v_always, false)
    or least(rq.starts_at, tg.starts_at) <= now() + make_interval(hours => coalesce(v_free, 12));

  if v_needs then
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

revoke execute on all functions in schema public from anon, public;
