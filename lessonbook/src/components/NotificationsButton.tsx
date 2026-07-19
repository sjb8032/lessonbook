"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Notif = {
  id: string;
  body: string;
  link: string | null;
  read: boolean;
  created_at: string;
};

export default function NotificationsButton() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Notif[]>([]);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("read", false)
      .then(({ count }) => setUnread(count ?? 0));
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("notifications")
      .select("id, body, link, read, created_at")
      .order("created_at", { ascending: false })
      .limit(15);
    setItems((data as Notif[]) ?? []);
    await supabase.from("notifications").update({ read: true }).eq("read", false);
    setUnread(0);
  }

  return (
    <div className="relative">
      <button
        onClick={toggle}
        aria-label="알림"
        className="relative rounded-lg px-2 py-1 text-sm hover:bg-line/50"
      >
        🔔
        {unread > 0 && (
          <span className="num absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-redpen px-1 text-[10px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-xl border border-line bg-card p-2 shadow-lg">
          {items.length === 0 ? (
            <p className="p-4 text-sm text-ink-soft">아직 알림이 없어요</p>
          ) : (
            <ul className="ruled max-h-96 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id} className="px-2 py-3 text-sm">
                  {n.link ? (
                    <Link href={n.link} onClick={() => setOpen(false)}>
                      {n.body}
                    </Link>
                  ) : (
                    n.body
                  )}
                  <p className="mt-0.5 text-xs text-ink-soft">
                    {new Date(n.created_at).toLocaleString("ko-KR", {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
