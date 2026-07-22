-- =============================================================
-- 0015: 학생에게는 지난 시간을 숨긴다
--
--   지난 슬롯(빈 시간, 남의 예약)은 학생 시간표에서 제외.
--   단, 자기가 수업한 기록(내 예약)은 지난 것도 그대로 보인다.
--   선생님은 전부 본다.
-- =============================================================

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
    -- 학생은 지난 시간 중 자기 예약만 본다
    and (auth.uid() = p_teacher or s.starts_at > now() or e.student_id = auth.uid())
  order by s.starts_at;
end $$;

revoke execute on all functions in schema public from anon, public;
