import { createClient } from "@/lib/supabase/server";
import RequestInbox from "@/components/RequestInbox";
import type { ClassRow, TeacherRequest } from "@/lib/types";

export default async function RequestsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_teacher_requests");
  const { data: classData } = await supabase.rpc("get_classes");
  const classes = ((classData as ClassRow[]) ?? []).filter((c) => !c.archived);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">승인 대기</h1>
        <p className="mt-1 text-sm text-ink-soft">
          기준 시간 안쪽에서 들어온 예약·취소 신청과, 학생끼리 합의된 시간 교환이
          여기로 모여요.
        </p>
      </div>
      {error ? (
        <p className="text-sm text-redpen">{error.message}</p>
      ) : (
        <RequestInbox
          requests={(data as TeacherRequest[]) ?? []}
          classes={classes}
        />
      )}
    </div>
  );
}
