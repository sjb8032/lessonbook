"use client";

import { useEffect, useState } from "react";

/** 가입 코드 표시 + 카톡 등으로 보내기 좋은 안내문 복사/공유 */
export default function ShareJoinCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  // navigator.share 는 브라우저마다 달라서 마운트 후에만 판단 (hydration 불일치 방지)
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && !!navigator.share);
  }, []);

  function buildText() {
    return [
      "레슨북 수업 예약 안내",
      "",
      `1) ${window.location.origin} 접속해서 가입`,
      `2) 가입 코드 입력: ${code}`,
      "",
      "가입하면 시간표에서 바로 예약할 수 있어요!",
    ].join("\n");
  }

  async function copy() {
    await navigator.clipboard.writeText(buildText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function share() {
    try {
      await navigator.share({ text: buildText() });
    } catch {
      // 공유 시트를 닫은 경우 — 아무것도 안 함
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-pen-soft px-4 py-2.5">
      <div>
        <p className="text-xs text-pen">수강생 가입 코드</p>
        <p className="num text-lg font-bold tracking-[0.25em] text-pen">
          {code}
        </p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <button
          onClick={copy}
          className="rounded-lg bg-card px-3 py-2 text-xs font-semibold text-pen shadow-sm"
        >
          {copied ? "복사됐어요 ✓" : "안내문 복사"}
        </button>
        {canShare && (
          <button
            onClick={share}
            className="rounded-lg bg-pen px-3 py-2 text-xs font-semibold text-white"
          >
            공유
          </button>
        )}
      </div>
    </div>
  );
}
