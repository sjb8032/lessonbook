"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { respondSwap } from "@/actions/swaps";

export default function SwapRespond({ swapId }: { swapId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function respond(accept: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await respondSwap(swapId, accept);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="mt-3">
      <div className="flex gap-2">
        <button
          disabled={pending}
          onClick={() => respond(true)}
          className="flex-1 rounded-xl bg-pen py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          수락하고 시간 바꾸기
        </button>
        <button
          disabled={pending}
          onClick={() => respond(false)}
          className="flex-1 rounded-xl border border-line py-2.5 text-sm text-ink-soft disabled:opacity-40"
        >
          거절
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-redpen">{error}</p>}
    </div>
  );
}
