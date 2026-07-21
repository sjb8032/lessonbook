"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  BookingPolicy,
  ClassOption,
  ScheduleRow,
  SlotKind,
} from "@/lib/types";
import { addDays, fmtDay, fmtTime, sameDate, startOfWeek } from "@/lib/utils";
import { openSlots, closeSlot, copyWeek } from "@/actions/slots";
import {
  bookSlot,
  cancelBooking,
  completeLesson,
  respondBooking,
  respondCancel,
} from "@/actions/bookings";
import { requestSwap } from "@/actions/swaps";

/** 수업 시작까지 남은 시간이 기준(시간) 안쪽이면 선생님 승인이 필요하다 */
function needsApproval(startsAt: string, freeHours: number): boolean {
  return new Date(startsAt).getTime() - Date.now() <= freeHours * 3600_000;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i); // 00시–23시 시작
const SCROLL_TO_HOUR = 8; // 목록을 열었을 때 처음 보이는 시각

const KIND_LABEL: Record<SlotKind, string> = {
  lesson: "수업",
  recording: "녹음",
  trial: "체험",
};

/** 슬롯 앞에 붙일 짧은 꼬리표 (녹음/체험, 또는 반 이름) */
function slotTag(row: ScheduleRow): string | null {
  if (row.kind === "recording") return "🎙 녹음";
  if (row.kind === "trial") return "체험";
  if (row.class_name) return row.class_name;
  return null;
}

type Sheet = { kind: "slot"; row: ScheduleRow } | null;

export default function DaySchedule({
  role,
  rows,
  monthOffset,
  lessonMinutes,
  policy,
  classes,
}: {
  role: "teacher" | "student";
  rows: ScheduleRow[];
  monthOffset: number;
  lessonMinutes: number;
  policy: BookingPolicy;
  // 선생님: 자기 반 전체 / 학생: 내가 속한 반 (예약 시 반 선택용)
  classes: ClassOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [error, setError] = useState<string | null>(null);
  const [swapSource, setSwapSource] = useState<string>("");
  const [swapMessage, setSwapMessage] = useState("");

  // 시간 열 때: 종류 + (수업이면) 반 제한
  const [openKind, setOpenKind] = useState<SlotKind>("lesson");
  const [openClassId, setOpenClassId] = useState<string>(""); // "" = 제한 없음

  const monthStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
    d.setMonth(d.getMonth() + monthOffset);
    return d;
  }, [monthOffset]);
  const monthDays = useMemo(() => {
    const n = new Date(
      monthStart.getFullYear(),
      monthStart.getMonth() + 1,
      0
    ).getDate();
    return Array.from(
      { length: n },
      (_, i) => new Date(monthStart.getFullYear(), monthStart.getMonth(), i + 1)
    );
  }, [monthStart]);
  const leadingBlanks = (monthStart.getDay() + 6) % 7; // 월요일 시작 달력

  const today = new Date();
  const [dayIdx, setDayIdx] = useState(
    monthOffset === 0 ? today.getDate() - 1 : 0
  );
  const selectedDay = monthDays[Math.min(dayIdx, monthDays.length - 1)];

  // 달을 옮기면 오늘(이번 달) 또는 1일로 선택 초기화
  useEffect(() => {
    setDayIdx(monthOffset === 0 ? new Date().getDate() - 1 : 0);
  }, [monthOffset]);

  // 날짜별 요약: 전체 슬롯 수 / 예약(대기·확정·완료 포함)된 수
  const dayStats = useMemo(() => {
    const map = new Map<number, { total: number; booked: number }>();
    for (const r of rows) {
      const d = new Date(r.starts_at);
      if (
        d.getFullYear() !== monthStart.getFullYear() ||
        d.getMonth() !== monthStart.getMonth()
      )
        continue;
      const s = map.get(d.getDate()) ?? { total: 0, booked: 0 };
      s.total++;
      if (r.booking_id) s.booked++;
      map.set(d.getDate(), s);
    }
    return map;
  }, [rows, monthStart]);

  const dayRows = useMemo(
    () =>
      rows
        .filter((r) => sameDate(new Date(r.starts_at), selectedDay))
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [rows, selectedDay]
  );

  // 아직 슬롯이 없어 새로 열 수 있는 시각
  const openableHours = useMemo(() => {
    const taken = new Set(dayRows.map((r) => new Date(r.starts_at).getHours()));
    return new Set(HOURS.filter((h) => !taken.has(h)));
  }, [dayRows]);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const dragRef = useRef<{ anchor: number; add: boolean; base: Set<number> } | null>(
    null
  );
  const skipClickRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  // 날짜/달을 옮기면 선택은 초기화하고, 목록은 이른 아침이 아니라 활동 시간대부터 보이게
  useEffect(() => {
    setSelected(new Set());
    const el = listRef.current;
    const target = el?.querySelector<HTMLElement>(`[data-hour="${SCROLL_TO_HOUR}"]`);
    if (el && target) el.scrollTop = target.offsetTop;
  }, [dayIdx, monthOffset]);

  function hourAt(x: number, y: number): number | null {
    const el = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-hour]");
    if (!el || el.dataset.openable !== "1") return null;
    return Number(el.dataset.hour);
  }

  function selectRange(anchor: number, to: number, add: boolean, base: Set<number>) {
    const [lo, hi] = anchor <= to ? [anchor, to] : [to, anchor];
    const next = new Set(base);
    for (let h = lo; h <= hi; h++) {
      if (!openableHours.has(h)) continue;
      if (add) next.add(h);
      else next.delete(h);
    }
    setSelected(next);
  }

  function toggleHour(h: number) {
    if (skipClickRef.current) {
      skipClickRef.current = false; // 마우스 드래그가 이미 처리함
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(h)) next.delete(h);
      else next.add(h);
      return next;
    });
  }

  // 마우스/펜은 드래그로 범위 선택. 터치는 탭 토글만 (드래그를 가로채면 목록을 못 넘김)
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "touch") return;
    const h = hourAt(e.clientX, e.clientY);
    if (h === null) return;
    const add = !selected.has(h);
    const base = new Set(selected);
    dragRef.current = { anchor: h, add, base };
    skipClickRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    selectRange(h, h, add, base);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const h = hourAt(e.clientX, e.clientY);
    if (h === null) return;
    selectRange(drag.anchor, h, drag.add, drag.base);
  }

  const myFutureBookings = useMemo(
    () =>
      rows
        .filter(
          (r) =>
            r.is_mine &&
            r.booking_id &&
            r.booking_status === "confirmed" &&
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
      {/* 달 이동 */}
      <div className="flex items-center justify-between px-1">
        <Link
          href={`?m=${monthOffset - 1}`}
          className="rounded-lg px-3 py-1 text-sm text-ink-soft hover:bg-line/50"
        >
          ← 지난달
        </Link>
        <span className="num text-sm font-semibold">
          {monthStart.getFullYear()}년 {monthStart.getMonth() + 1}월
        </span>
        <Link
          href={`?m=${monthOffset + 1}`}
          className="rounded-lg px-3 py-1 text-sm text-ink-soft hover:bg-line/50"
        >
          다음달 →
        </Link>
      </div>

      {/* 월 달력 — 날짜마다 예약/전체 요약 */}
      <div className="mt-3 rounded-2xl border border-line bg-card p-2">
        <div className="grid grid-cols-7 gap-1 text-center">
          {["월", "화", "수", "목", "금", "토", "일"].map((d) => (
            <div key={d} className="py-1 text-xs font-medium text-ink-soft">
              {d}
            </div>
          ))}
          {Array.from({ length: leadingBlanks }, (_, i) => (
            <div key={`b${i}`} />
          ))}
          {monthDays.map((d, i) => {
            const stats = dayStats.get(d.getDate());
            const active = i === dayIdx;
            const isToday = sameDate(d, today);
            const full = stats && stats.booked >= stats.total;
            return (
              <button
                key={i}
                onClick={() => setDayIdx(i)}
                className={`rounded-lg py-1 ${
                  active
                    ? "bg-ink text-white"
                    : isToday
                    ? "bg-pen-soft"
                    : "hover:bg-line/40"
                }`}
              >
                <div className={`num text-sm ${active ? "font-semibold" : ""}`}>
                  {d.getDate()}
                </div>
                <div
                  className={`num h-4 text-[10px] leading-4 ${
                    active
                      ? "text-white/80"
                      : !stats
                      ? ""
                      : full
                      ? "text-ink-soft"
                      : "font-semibold text-pen"
                  }`}
                >
                  {stats ? `${stats.booked}/${stats.total}` : ""}
                </div>
              </button>
            );
          })}
        </div>
        <p className="mt-1 px-1 pb-1 text-right text-[10px] text-ink-soft">
          예약 / 열린 시간
        </p>
      </div>

      {/* 선택한 날짜 */}
      <p className="mt-4 px-1 text-sm font-semibold">{fmtDay(selectedDay)}</p>

      {/* 하루 시간표 — 괘선 리스트 */}
      <div className="mt-2 rounded-2xl border border-line bg-card px-4 py-1">
        {role === "teacher" ? (
          <div
            ref={listRef}
            className="relative max-h-[58vh] overflow-y-auto"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => (dragRef.current = null)}
            onPointerCancel={() => (dragRef.current = null)}
          >
            <ul className="ruled">
              {HOURS.map((h) => {
                const row = dayRows.find(
                  (r) => new Date(r.starts_at).getHours() === h
                );
                const isSelected = selected.has(h);
                return (
                  <li
                    key={h}
                    data-hour={h}
                    data-openable={row ? "0" : "1"}
                    className="flex items-center gap-3 py-2"
                  >
                    <span className="num w-12 text-sm text-ink-soft">
                      {String(h).padStart(2, "0")}:00
                    </span>
                    {!row ? (
                      <button
                        onClick={() => toggleHour(h)}
                        className={`flex-1 select-none rounded-lg py-1.5 text-left text-sm ${
                          isSelected
                            ? "bg-pen px-2 font-medium text-white"
                            : "text-line hover:bg-pen-soft hover:text-pen"
                        }`}
                      >
                        {isSelected ? "선택됨" : "+ 시간 열기"}
                      </button>
                    ) : (
                      <SlotChip
                        row={row}
                        role={role}
                        onTap={() => setSheet({ kind: "slot", row })}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
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

      {/* 선택한 시간 한 번에 열기 */}
      {role === "teacher" && selected.size > 0 && (
        <div className="sticky bottom-3 z-30 mt-3 space-y-2 rounded-xl border border-line bg-card p-3 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="num text-sm font-semibold">
              {selected.size}시간 선택
            </span>
            <button
              onClick={() => setSelected(new Set())}
              className="rounded-lg px-2 py-1 text-sm text-ink-soft hover:bg-line/50"
            >
              해제
            </button>
          </div>

          {/* 종류 — 체험을 꺼두면 체험 옵션은 숨김 */}
          <div className="flex gap-1 rounded-xl bg-line/40 p-1">
            {(
              policy.allow_trial
                ? (["lesson", "recording", "trial"] as SlotKind[])
                : (["lesson", "recording"] as SlotKind[])
            ).map((k) => (
              <button
                key={k}
                onClick={() => setOpenKind(k)}
                className={`flex-1 rounded-lg py-1.5 text-sm font-medium ${
                  openKind === k
                    ? "bg-card text-pen shadow-sm"
                    : "text-ink-soft"
                }`}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>

          {/* 반 제한 — 수업일 때만 */}
          {openKind === "lesson" && classes.length > 0 && (
            <select
              value={openClassId}
              onChange={(e) => setOpenClassId(e.target.value)}
              className="w-full rounded-xl border border-line bg-card px-3 py-2.5 text-sm"
            >
              <option value="">모든 반 (제한 없음)</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} 전용
                </option>
              ))}
            </select>
          )}

          <button
            disabled={pending}
            onClick={() =>
              run(async () => {
                const res = await openSlots(
                  [...selected].sort((a, b) => a - b).map((h) => {
                    const start = new Date(selectedDay);
                    start.setHours(h, 0, 0, 0);
                    return start.toISOString();
                  }),
                  lessonMinutes,
                  openKind,
                  openKind === "lesson" ? openClassId || null : null
                );
                if (!res.error) setSelected(new Set());
                return res;
              })
            }
            className="w-full rounded-lg bg-pen py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {KIND_LABEL[openKind]} 시간으로 열기
          </button>
        </div>
      )}

      {error && !sheet && (
        <p className="mt-2 text-sm text-redpen">{error}</p>
      )}

      {role === "teacher" && (
        <button
          disabled={pending}
          onClick={() => {
            const ws = startOfWeek(selectedDay);
            run(() => copyWeek(ws.toISOString(), addDays(ws, 7).toISOString()));
          }}
          className="mt-3 w-full rounded-xl border border-line bg-card py-2.5 text-sm text-ink-soft hover:border-pen hover:text-pen disabled:opacity-50"
        >
          선택한 날짜의 주 시간표를 다음 주로 복사
        </button>
      )}

      {/* 바텀 시트 */}
      {sheet && (
        <div className="fixed inset-0 z-40 flex items-end bg-ink/30" onClick={closeSheet}>
          <div
            className="w-full rounded-t-2xl bg-card p-5 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <SlotSheet
              key={sheet.row.slot_id}
              row={sheet.row}
              role={role}
              policy={policy}
              classes={classes}
              pending={pending}
              error={error}
              run={run}
              myFutureBookings={myFutureBookings}
              swapSource={swapSource}
              setSwapSource={setSwapSource}
              swapMessage={swapMessage}
              setSwapMessage={setSwapMessage}
            />
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
  const tag = slotTag(row);

  if (row.slot_status === "open") {
    const base = role === "teacher" ? "비어 있음" : "탭해서 예약";
    return (
      <button
        onClick={onTap}
        className="flex-1 rounded-lg bg-pen-soft py-1.5 text-left text-sm font-medium text-pen"
      >
        <span className="px-2">{tag ? `${tag} · ${base}` : `예약 가능 · ${base}`}</span>
      </button>
    );
  }

  const done = row.session_done;
  const mine = row.is_mine;
  const waiting = row.booking_status === "pending";
  const cancelWaiting = row.cancel_requested;
  const who =
    role === "teacher" ? row.student_label : mine ? "내 수업" : row.student_label;
  // 녹음/체험이면 종류를, 아니면 반 이름을 앞에 붙인다
  const prefix = row.kind !== "lesson" ? `${slotTag(row)} · ` : "";

  return (
    <button
      onClick={onTap}
      className={`flex-1 rounded-lg py-1.5 text-left text-sm font-medium ${
        done
          ? "bg-ok-soft text-ok"
          : waiting || cancelWaiting
          ? "border border-dashed border-pen bg-pen-soft text-pen"
          : mine
          ? "bg-ink text-white"
          : "bg-line/60 text-ink"
      }`}
    >
      <span className="px-2">
        {done && "✓ "}
        {prefix}
        {who}
        {done && " · 완료"}
        {waiting && " · 승인 대기"}
        {!waiting && cancelWaiting && " · 취소 요청"}
      </span>
    </button>
  );
}

function SlotSheet({
  row,
  role,
  policy,
  classes,
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
  policy: BookingPolicy;
  classes: ClassOption[];
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
  const waiting = row.booking_status === "pending";
  const cancelWaiting = !!row.cancel_requested;
  const bookNeedsApproval = needsApproval(row.starts_at, policy.book_free_hours);
  const cancelNeedsApproval = needsApproval(
    row.starts_at,
    policy.cancel_free_hours
  );

  // 학생이 제한 없는 수업을 예약할 때: 여러 반 소속이면 어느 반인지 골라야 한다
  const needClassPick =
    role === "student" &&
    row.kind === "lesson" &&
    !row.class_id &&
    classes.length > 1;
  const [bookClass, setBookClass] = useState("");

  const tag = slotTag(row);

  return (
    <>
      <p className="font-semibold">{time}</p>
      {tag && (
        <span className="mt-1 inline-block rounded-full bg-line/50 px-2 py-0.5 text-xs text-ink-soft">
          {row.kind === "lesson" ? `${tag} 전용` : tag}
        </span>
      )}

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

      {/* 선생님 — 예약 신청 승인 대기 */}
      {role === "teacher" && waiting && (
        <>
          <p className="mt-1 text-sm text-ink-soft">
            <b>{row.student_label}</b> 학생이 이 시간을 신청했어요. 승인해야
            확정돼요.
          </p>
          <div className="mt-4 space-y-2">
            <button
              disabled={pending}
              onClick={() => run(() => respondBooking(row.booking_id!, true))}
              className="w-full rounded-xl bg-pen py-3 font-semibold text-white disabled:opacity-50"
            >
              예약 승인
            </button>
            <button
              disabled={pending}
              onClick={() => run(() => respondBooking(row.booking_id!, false))}
              className="w-full rounded-xl border border-line py-3 text-ink-soft disabled:opacity-50"
            >
              반려 (시간이 다시 열려요)
            </button>
          </div>
        </>
      )}

      {/* 선생님 — 취소 요청 승인 대기 */}
      {role === "teacher" && cancelWaiting && !waiting && (
        <>
          <p className="mt-1 text-sm text-ink-soft">
            <b>{row.student_label}</b> 학생이 취소를 요청했어요.
          </p>
          <div className="mt-4 space-y-2">
            <button
              disabled={pending}
              onClick={() => run(() => respondCancel(row.booking_id!, true))}
              className="w-full rounded-xl bg-pen py-3 font-semibold text-white disabled:opacity-50"
            >
              취소 승인 (시간이 다시 열려요)
            </button>
            <button
              disabled={pending}
              onClick={() => run(() => respondCancel(row.booking_id!, false))}
              className="w-full rounded-xl border border-line py-3 text-ink-soft disabled:opacity-50"
            >
              반려 (수업 유지)
            </button>
          </div>
        </>
      )}

      {role === "teacher" &&
        row.booking_id &&
        !row.session_done &&
        !waiting &&
        !cancelWaiting && (
          <>
            <p className="mt-1 text-sm text-ink-soft">
              {row.student_label} 학생 예약
            </p>
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
          <p className="mt-1 text-sm text-ink-soft">
            {bookNeedsApproval
              ? `${KIND_LABEL[row.kind]}이 ${policy.book_free_hours}시간 안쪽이라 선생님 승인을 받아야 확정돼요`
              : `예약 가능한 ${KIND_LABEL[row.kind]} 시간이에요`}
          </p>
          {row.kind === "trial" && (
            <p className="mt-1 text-xs text-ink-soft">
              체험비{" "}
              <b className="num">
                {policy.trial_price > 0
                  ? `${policy.trial_price.toLocaleString("ko-KR")}원`
                  : "무료"}
              </b>
              {` · 1인당 ${policy.trial_limit}회까지 신청할 수 있어요`}
            </p>
          )}

          {needClassPick && (
            <>
              <label className="mt-4 block text-sm font-medium">
                어느 반 수업으로 잡을까요?
              </label>
              <select
                value={bookClass}
                onChange={(e) => setBookClass(e.target.value)}
                className="mt-1 w-full rounded-xl border border-line bg-card px-3 py-3"
              >
                <option value="">반 선택</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </>
          )}

          <button
            disabled={pending || !isFuture || (needClassPick && !bookClass)}
            onClick={() =>
              run(() =>
                bookSlot(row.slot_id, needClassPick ? bookClass : undefined)
              )
            }
            className="mt-4 w-full rounded-xl bg-pen py-3 font-semibold text-white disabled:opacity-50"
          >
            {bookNeedsApproval
              ? `${KIND_LABEL[row.kind]} 신청하기`
              : `이 ${KIND_LABEL[row.kind]} 예약하기`}
          </button>
        </>
      )}

      {/* 학생 — 내 수업 */}
      {role === "student" && row.is_mine && row.booking_id && !row.session_done && (
        <>
          <p className="mt-1 text-sm text-ink-soft">
            {waiting
              ? "선생님 승인을 기다리는 중이에요"
              : cancelWaiting
              ? "취소 요청을 보냈어요. 선생님 승인을 기다리는 중이에요"
              : "내 수업이에요"}
          </p>

          {!policy.allow_student_cancel && !waiting ? (
            <p className="mt-4 rounded-xl bg-line/40 p-3 text-sm text-ink-soft">
              선생님이 학생 취소를 막아두셨어요. 선생님께 직접 말씀해 주세요.
            </p>
          ) : cancelWaiting ? (
            <p className="mt-4 rounded-xl bg-pen-soft p-3 text-sm text-pen">
              취소 요청이 이미 접수됐어요
            </p>
          ) : (
            <>
              <button
                disabled={pending}
                onClick={() => run(() => cancelBooking(row.booking_id!))}
                className="mt-4 w-full rounded-xl border border-redpen py-3 font-semibold text-redpen disabled:opacity-50"
              >
                {waiting
                  ? "신청 취소하기"
                  : cancelNeedsApproval
                  ? "취소 요청 보내기"
                  : "예약 취소 (시간이 다시 열려요)"}
              </button>
              <p className="mt-2 text-xs text-ink-soft">
                {waiting
                  ? "아직 승인 전이라 바로 거둬들일 수 있어요"
                  : cancelNeedsApproval
                  ? `수업 ${policy.cancel_free_hours}시간 안쪽이라 선생님이 승인해야 취소돼요`
                  : `수업 ${policy.cancel_free_hours}시간 전까지는 바로 취소할 수 있어요`}
              </p>
            </>
          )}
        </>
      )}

      {role === "student" &&
        !row.is_mine &&
        row.booking_id &&
        !row.session_done &&
        !waiting &&
        policy.allow_student_swap &&
        isFuture && (
          <>
            <p className="mt-1 text-sm text-ink-soft">
              {row.student_label} 님의 수업이에요. 내 수업과 시간을 바꿔달라고
              요청할 수 있어요
            </p>
            <p className="mt-1 text-xs text-ink-soft">
              {policy.swap_needs_approval
                ? "교환은 상대가 수락한 뒤 선생님 승인까지 받아야 확정돼요"
                : needsApproval(row.starts_at, policy.swap_free_hours)
                ? `수업 ${policy.swap_free_hours}시간 안쪽이라 상대가 수락해도 선생님 승인이 필요해요`
                : `수업 ${policy.swap_free_hours}시간 전까지는 상대가 수락하면 바로 바뀌어요`}
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
