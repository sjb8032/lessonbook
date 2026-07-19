"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ScheduleRow } from "@/lib/types";
import { addDays, fmtDay, fmtTime, sameDate, startOfWeek } from "@/lib/utils";
import { openSlot, closeSlot, copyWeek } from "@/actions/slots";
import { bookSlot, cancelBooking, completeLesson } from "@/actions/bookings";
import { requestSwap } from "@/actions/swaps";

const HOURS = Array.from({ length: 13 }, (_, i) => i + 9); // 09시–21시 시작

type Sheet =
  | { kind: "open-hour"; date: Date }
  | { kind: "slot"; row: ScheduleRow }
  | null;

export default function DaySchedule({
  role,
  rows,
  weekOffset,
  lessonMinutes,
}: {
  role: "teacher" | "student";
  rows: ScheduleRow[];
  weekOffset: number;
  lessonMinutes: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [error, setError] = useState<string | null>(null);
  const [swapSource, setSwapSource] = useState<string>("");
  const [swapMessage, setSwapMessage] = useState("");

  const weekStart = useMemo(
    () => addDays(startOfWeek(new Date()), weekOffset * 7),
    [weekOffset]
  );
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const today = new Date();
  const defaultDay = days.findIndex((d) => sameDate(d, today));
  const [dayIdx, setDayIdx] = useState(defaultDay >= 0 ? defaultDay : 0);
  const selectedDay = days[dayIdx];

  const dayRows = useMemo(
    () =>
      rows
        .filter((r) => sameDate(new Date(r.starts_at), selectedDay))
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [rows, selectedDay]
  );

  const myFutureBookings = useMemo(
    () =>
      rows
        .filter(
          (r) =>
            r.is_mine &&
            r.booking_id &&
            !r.session_done &&
            new Date(r.starts_at) > new Date()
        )
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [rows]
  );

  function run(action: () => Promise<{ error: string | null }>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.error) setError(res.error);
      else {
        setSheet(null);
        setSwapSource("");
        setSwapMessage("");
        router.refresh();
      }
    });
  }

  function closeSheet() {
    setSheet(null);
    setError(null);
  }

  return (
    <div>
      {/* 주 이동 */}
      <div className="flex items-center justify-between px-1">
        <Link
          href={`?w=${weekOffset - 1}`}
          className="rounded-lg px-3 py-1 text-sm text-ink-soft hover:bg-line/50"
        >
          ← 지난주
        </Link>
        <span className="num text-sm font-semibold">
          {fmtDay(weekStart)} – {fmtDay(days[6])}
        </span>
        <Link
          href={`?w=${weekOffset + 1}`}
          className="rounded-lg px-3 py-1 text-sm text-ink-soft hover:bg-line/50"
        >
          다음주 →
        </Link>
      </div>

      {/* 요일 스트립 */}
      <div className="mt-3 grid grid-cols-7 gap-1">
        {days.map((d, i) => {
          const count = rows.filter((r) =>
            sameDate(new Date(r.starts_at), d)
          ).length;
          const active = i === dayIdx;
          return (
            <button
              key={i}
              onClick={() => setDayIdx(i)}
              className={`rounded-xl py-2 text-center text-sm ${
                active
                  ? "bg-ink font-semibold text-white"
                  : "bg-card text-ink-soft hover:bg-pen-soft"
              }`}
            >
              <div>{["월", "화", "수", "목", "금", "토", "일"][i]}</div>
              <div className="num text-xs">{d.getDate()}</div>
              {count > 0 && (
                <div
                  className={`mx-auto mt-1 h-1 w-1 rounded-full ${
                    active ? "bg-white" : "bg-pen"
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* 하루 시간표 — 괘선 리스트 */}
      <div className="mt-4 rounded-2xl border border-line bg-card px-4 py-1">
        {role === "teacher" ? (
          <ul className="ruled">
            {HOURS.map((h) => {
              const start = new Date(selectedDay);
              start.setHours(h, 0, 0, 0);
              const row = dayRows.find(
                (r) => new Date(r.starts_at).getHours() === h
              );
              return (
                <li key={h} className="flex items-center gap-3 py-2.5">
                  <span className="num w-12 text-sm text-ink-soft">
                    {String(h).padStart(2, "0")}:00
                  </span>
                  {!row ? (
                    <button
                      onClick={() => setSheet({ kind: "open-hour", date: start })}
                      className="flex-1 rounded-lg py-1.5 text-left text-sm text-line hover:bg-pen-soft hover:text-pen"
                    >
                      + 시간 열기
                    </button>
                  ) : (
                    <SlotChip row={row} role={role} onTap={() => setSheet({ kind: "slot", row })} />
                  )}
                </li>
              );
            })}
          </ul>
        ) : dayRows.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-soft">
            이 날은 열린 시간이 없어요
          </p>
        ) : (
          <ul className="ruled">
            {dayRows.map((row) => (
              <li key={row.slot_id} className="flex items-center gap-3 py-2.5">
                <span className="num w-12 text-sm text-ink-soft">
                  {fmtTime(row.starts_at)}
                </span>
                <SlotChip row={row} role={role} onTap={() => setSheet({ kind: "slot", row })} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {role === "teacher" && (
        <button
          disabled={pending}
          onClick={() =>
            run(() =>
              copyWeek(weekStart.toISOString(), addDays(weekStart, 7).toISOString())
            )
          }
          className="mt-3 w-full rounded-xl border border-line bg-card py-2.5 text-sm text-ink-soft hover:border-pen hover:text-pen disabled:opacity-50"
        >
          이번 주 시간표를 다음 주로 복사
        </button>
      )}

      {/* 바텀 시트 */}
      {sheet && (
        <div className="fixed inset-0 z-40 flex items-end bg-ink/30" onClick={closeSheet}>
          <div
            className="w-full rounded-t-2xl bg-card p-5 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            {sheet.kind === "open-hour" && (
              <>
                <p className="font-semibold">
                  {fmtDay(sheet.date)} {fmtTime(sheet.date.toISOString())} 시간을 열까요?
                </p>
                <p className="mt-1 text-sm text-ink-soft">
                  수강생들이 이 시간을 보고 직접 예약할 수 있어요
                </p>
                <button
                  disabled={pending}
                  onClick={() =>
                    run(() => openSlot(sheet.date.toISOString(), lessonMinutes))
                  }
                  className="mt-4 w-full rounded-xl bg-pen py-3 font-semibold text-white disabled:opacity-50"
                >
                  예약 가능 시간으로 열기
                </button>
              </>
            )}

            {sheet.kind === "slot" && (
              <SlotSheet
                row={sheet.row}
                role={role}
                pending={pending}
                error={error}
                run={run}
                myFutureBookings={myFutureBookings}
                swapSource={swapSource}
                setSwapSource={setSwapSource}
                swapMessage={swapMessage}
                setSwapMessage={setSwapMessage}
              />
            )}
            {error && sheet.kind === "open-hour" && (
              <p className="mt-2 text-sm text-redpen">{error}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SlotChip({
  row,
  role,
  onTap,
}: {
  row: ScheduleRow;
  role: "teacher" | "student";
  onTap: () => void;
}) {
  if (row.slot_status === "open") {
    return (
      <button
        onClick={onTap}
        className="flex-1 rounded-lg bg-pen-soft py-1.5 text-left text-sm font-medium text-pen"
      >
        <span className="px-2">
          {role === "teacher" ? "예약 가능 (비어 있음)" : "예약 가능 · 탭해서 예약"}
        </span>
      </button>
    );
  }
  const done = row.session_done;
  const mine = row.is_mine;
  return (
    <button
      onClick={onTap}
      className={`flex-1 rounded-lg py-1.5 text-left text-sm font-medium ${
        done
          ? "bg-ok-soft text-ok"
          : mine
          ? "bg-ink text-white"
          : "bg-line/60 text-ink"
      }`}
    >
      <span className="px-2">
        {done && "✓ "}
        {role === "teacher" ? row.student_label : mine ? "내 수업" : row.student_label}
        {done && " · 완료"}
      </span>
    </button>
  );
}

function SlotSheet({
  row,
  role,
  pending,
  error,
  run,
  myFutureBookings,
  swapSource,
  setSwapSource,
  swapMessage,
  setSwapMessage,
}: {
  row: ScheduleRow;
  role: "teacher" | "student";
  pending: boolean;
  error: string | null;
  run: (a: () => Promise<{ error: string | null }>) => void;
  myFutureBookings: ScheduleRow[];
  swapSource: string;
  setSwapSource: (v: string) => void;
  swapMessage: string;
  setSwapMessage: (v: string) => void;
}) {
  const time = `${fmtDay(new Date(row.starts_at))} ${fmtTime(row.starts_at)}`;
  const isFuture = new Date(row.starts_at) > new Date();

  return (
    <>
      <p className="font-semibold">{time}</p>

      {/* 선생님 */}
      {role === "teacher" && row.slot_status === "open" && (
        <>
          <p className="mt-1 text-sm text-ink-soft">아직 예약이 없는 시간이에요</p>
          <button
            disabled={pending}
            onClick={() => run(() => closeSlot(row.slot_id))}
            className="mt-4 w-full rounded-xl border border-redpen py-3 font-semibold text-redpen disabled:opacity-50"
          >
            이 시간 닫기
          </button>
        </>
      )}
      {role === "teacher" && row.booking_id && !row.session_done && (
        <>
          <p className="mt-1 text-sm text-ink-soft">{row.student_label} 학생 예약</p>
          <div className="mt-4 space-y-2">
            <button
              disabled={pending}
              onClick={() => run(() => completeLesson(row.booking_id!))}
              className="w-full rounded-xl bg-pen py-3 font-semibold text-white disabled:opacity-50"
            >
              수업 완료 처리 (회차 +1)
            </button>
            <button
              disabled={pending}
              onClick={() => run(() => cancelBooking(row.booking_id!))}
              className="w-full rounded-xl border border-line py-3 text-ink-soft disabled:opacity-50"
            >
              예약 취소
            </button>
            {row.enrollment_id && (
              <Link
                href={`/t/students/${row.enrollment_id}`}
                className="block w-full rounded-xl border border-line py-3 text-center text-ink-soft"
              >
                학생 정보 · 일지 작성 →
              </Link>
            )}
          </div>
        </>
      )}
      {role === "teacher" && row.session_done && (
        <p className="mt-1 text-sm text-ok">완료된 수업이에요</p>
      )}

      {/* 학생 */}
      {role === "student" && row.slot_status === "open" && (
        <>
          <p className="mt-1 text-sm text-ink-soft">예약 가능한 시간이에요</p>
          <button
            disabled={pending || !isFuture}
            onClick={() => run(() => bookSlot(row.slot_id))}
            className="mt-4 w-full rounded-xl bg-pen py-3 font-semibold text-white disabled:opacity-50"
          >
            이 시간 예약하기
          </button>
        </>
      )}
      {role === "student" && row.is_mine && row.booking_id && !row.session_done && (
        <>
          <p className="mt-1 text-sm text-ink-soft">내 수업이에요</p>
          <button
            disabled={pending}
            onClick={() => run(() => cancelBooking(row.booking_id!))}
            className="mt-4 w-full rounded-xl border border-redpen py-3 font-semibold text-redpen disabled:opacity-50"
          >
            예약 취소 (시간이 다시 열려요)
          </button>
          <p className="mt-2 text-xs text-ink-soft">
            수업 12시간 전까지만 취소할 수 있어요
          </p>
        </>
      )}
      {role === "student" &&
        !row.is_mine &&
        row.booking_id &&
        !row.session_done &&
        isFuture && (
          <>
            <p className="mt-1 text-sm text-ink-soft">
              {row.student_label} 님의 수업이에요. 내 수업과 시간을 바꿔달라고
              요청할 수 있어요
            </p>
            {myFutureBookings.length === 0 ? (
              <p className="mt-4 rounded-xl bg-line/40 p-3 text-sm text-ink-soft">
                교환하려면 먼저 내 예약이 있어야 해요
              </p>
            ) : (
              <>
                <label className="mt-4 block text-sm font-medium">
                  내 어떤 수업과 바꿀까요?
                </label>
                <select
                  value={swapSource}
                  onChange={(e) => setSwapSource(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-line bg-card px-3 py-3"
                >
                  <option value="">수업 선택</option>
                  {myFutureBookings.map((b) => (
                    <option key={b.booking_id!} value={b.booking_id!}>
                      {fmtDay(new Date(b.starts_at))} {fmtTime(b.starts_at)}
                    </option>
                  ))}
                </select>
                <input
                  value={swapMessage}
                  onChange={(e) => setSwapMessage(e.target.value)}
                  placeholder="메시지 (선택)"
                  className="mt-2 w-full rounded-xl border border-line bg-card px-3 py-3 text-sm"
                />
                <button
                  disabled={pending || !swapSource}
                  onClick={() =>
                    run(() => requestSwap(swapSource, row.booking_id!, swapMessage))
                  }
                  className="mt-3 w-full rounded-xl bg-pen py-3 font-semibold text-white disabled:opacity-50"
                >
                  교환 요청 보내기
                </button>
              </>
            )}
          </>
        )}

      {error && <p className="mt-3 text-sm text-redpen">{error}</p>}
    </>
  );
}
