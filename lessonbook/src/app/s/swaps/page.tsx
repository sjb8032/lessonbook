import { createClient } from "@/lib/supabase/server";
import SwapRespond from "@/components/SwapRespond";
import { fmtDateTime } from "@/lib/utils";

type SwapRow = {
  id: string;
  direction: "incoming" | "outgoing";
  status: "pending" | "awaiting_teacher" | "accepted" | "declined" | "canceled";
  message: string | null;
  created_at: string;
  my_time: string;
  other_time: string;
  other_label: string;
};

const STATUS_LABEL: Record<SwapRow["status"], string> = {
  pending: "상대 응답 대기",
  awaiting_teacher: "선생님 승인 대기",
  accepted: "성사됨",
  declined: "거절됨",
  canceled: "취소됨",
};

export default async function SwapsPage() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_my_swaps");
  const swaps = (data as SwapRow[]) ?? [];
  const incoming = swaps.filter((s) => s.direction === "incoming" && s.status === "pending");
  const rest = swaps.filter((s) => !(s.direction === "incoming" && s.status === "pending"));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">시간 교환</h1>

      <section>
        <p className="text-sm font-semibold">받은 요청</p>
        {incoming.length === 0 ? (
          <p className="mt-2 rounded-xl border border-line bg-card p-4 text-sm text-ink-soft">
            받은 교환 요청이 없어요
          </p>
        ) : (
          <div className="mt-2 space-y-3">
            {incoming.map((s) => (
              <div key={s.id} className="rounded-2xl border border-pen bg-card p-4">
                <p className="text-sm">
                  <span className="font-semibold">{s.other_label}</span> 님이
                  시간을 바꾸고 싶어해요
                </p>
                <div className="num mt-2 rounded-xl bg-pen-soft p-3 text-sm">
                  <p>
                    내 수업 <span className="font-semibold">{fmtDateTime(s.my_time)}</span>
                  </p>
                  <p className="mt-1">
                    ↔ 상대 수업 <span className="font-semibold">{fmtDateTime(s.other_time)}</span>
                  </p>
                </div>
                {s.message && (
                  <p className="mt-2 text-sm text-ink-soft">"{s.message}"</p>
                )}
                <p className="mt-2 text-xs text-ink-soft">
                  수락하면 선생님 설정에 따라 바로 바뀌거나, 선생님 승인을 거쳐
                  확정돼요
                </p>
                <SwapRespond swapId={s.id} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <p className="text-sm font-semibold">지난 요청</p>
        {rest.length === 0 ? (
          <p className="mt-2 rounded-xl border border-line bg-card p-4 text-sm text-ink-soft">
            아직 주고받은 요청이 없어요. 스케줄에서 다른 수강생의 시간을 탭하면
            교환을 요청할 수 있어요.
          </p>
        ) : (
          <ul className="ruled mt-2 rounded-2xl border border-line bg-card px-4">
            {rest.map((s) => (
              <li key={s.id} className="py-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-ink-soft">
                    {s.direction === "outgoing" ? "보냄" : "받음"} ·{" "}
                    {s.other_label} 님
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      s.status === "accepted"
                        ? "bg-ok-soft text-ok"
                        : s.status === "pending" || s.status === "awaiting_teacher"
                        ? "bg-pen-soft text-pen"
                        : "bg-line/60 text-ink-soft"
                    }`}
                  >
                    {STATUS_LABEL[s.status]}
                  </span>
                </div>
                <p className="num mt-1 text-xs text-ink-soft">
                  {fmtDateTime(s.my_time)} ↔ {fmtDateTime(s.other_time)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
