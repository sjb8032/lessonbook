-- =============================================================
-- 0013: 승인 + 반 배정 한 번에
--
--   수강 연결 승인 시 반을 함께 골라 배정한다 (여러 반 가능).
--   결제 방식은 0011 트리거가 반 기본값을 물려주고,
--   배정은 지금처럼 반 관리(/t/classes)에서 언제든 바꿀 수 있다.
--   반을 안 고르고 승인해도 됨 (나중에 배정).
-- =============================================================

drop function if exists public.respond_enrollment(uuid, boolean);

create function public.respond_enrollment(
  p_enrollment uuid, p_accept boolean, p_class_ids uuid[] default '{}'
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v record;
  v_cnt int;
begin
  select e.id, e.status, e.student_id, e.teacher_id into v
  from public.enrollments e where e.id = p_enrollment for update;

  if v is null then raise exception '신청을 찾을 수 없어요'; end if;
  if auth.uid() <> v.teacher_id then raise exception '선생님만 처리할 수 있어요'; end if;
  if v.status <> 'pending' then raise exception '대기 중인 신청이 아니에요'; end if;

  if p_accept then
    if coalesce(array_length(p_class_ids, 1), 0) > 0 then
      select count(distinct c.id) into v_cnt from public.classes c
      where c.id = any(p_class_ids) and c.teacher_id = v.teacher_id and c.archived = false;
      if v_cnt <> (select count(distinct x) from unnest(p_class_ids) x) then
        raise exception '내 반이 아니거나 보관된 반이 포함돼 있어요';
      end if;
    end if;

    update public.enrollments set status = 'active', started_at = current_date
    where id = p_enrollment;

    -- 반 배정 (billing_method 는 0011 트리거가 반 기본값으로 채움)
    insert into public.class_members (class_id, enrollment_id)
    select distinct x, p_enrollment from unnest(p_class_ids) x
    on conflict (class_id, enrollment_id) do nothing;

    perform public.notify(v.student_id, 'enroll_accepted',
      '수강 연결이 승인됐어요! 이제 시간표에서 예약할 수 있어요', '/s/schedule');
  else
    update public.enrollments set status = 'rejected' where id = p_enrollment;
    perform public.notify(v.student_id, 'enroll_rejected',
      '수강 연결 신청이 거절됐어요', '/s/schedule');
  end if;
end $$;

revoke execute on all functions in schema public from anon, public;
